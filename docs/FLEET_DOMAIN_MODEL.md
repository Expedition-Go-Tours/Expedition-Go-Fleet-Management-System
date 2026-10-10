# Fleet Domain Model

Source-of-truth rules, entities, relationships and state transitions.
Terminology is fixed here; code uses these names.

## Entities and ownership

| Entity | Collection | Source of truth for |
| --- | --- | --- |
| `UserProfile` | `users` | Employee account, roles, status |
| `Vehicle` | `vehicles` | Canonical vehicle record; `odometerKm` is a **projection** of the ledger; `status` is a projection of holds/restrictions |
| `OdometerReading` | `odometerReadings` | Every accepted/flagged/superseded mileage observation |
| `MaintenanceTemplate` | `maintenanceTemplates` | Reusable task definition (intervals, thresholds) |
| `MaintenanceSchedule` | `maintenanceSchedules` | Per-vehicle configured task + authoritative baseline (`lastServiceOdometerKm`, `lastServiceDate`) |
| `ServiceRecord` | `serviceRecords` | Work actually completed (immutable once created) |
| `VehicleIssue` | `maintenanceReports` | Reported defect + full report history (collection name kept for audit continuity) |
| `IncidentReport` | `incidentReports` | Breakdown/accident/passenger events (restricted) |
| `WorkOrder` | `workOrders` | Repair execution workflow |
| `WorkOrderIssueLink` | `workOrderIssues` | Many-to-many issue↔work-order links |
| `VehicleAssignment` | `assignments` | Who used which vehicle, when, for what (trip/journey) |
| `Inspection` | `inspections` | Structured pre-trip/return checklist results |
| `Expense` | `expenses` | Recorded financial cost (no in-app approval) |
| `FuelEntry` | `fuelEntries` | Fuel purchase; links to canonical `Expense` for cost |
| `VehicleDocument` | `vehicleDocuments` | Registration/insurance/permit + expiry |
| `Notification` | `notifications` | In-app actionable notification (idempotent via `dedupeKey`) |
| `AuditEvent` | `auditLogs` | Significant changes (actor, before/after, reason) |

## Odometer ledger rules (§5 of requirements)

- `Vehicle.odometerKm` = highest **accepted** reading's km; only the
  transactional recorder may update it.
- Normal entries: km must be ≥ current projection; whole, non-negative km.
- Lower readings only via `odometer:correct` on an existing reading:
  original is superseded (kept, audited, reason mandatory), replacement
  created. Projection is recomputed from the highest accepted reading.
- Historical imports (`source: HISTORICAL_IMPORT`) never lower the projection;
  they are validated against neighbours around their effective time and
  flagged when conflicting.
- Idempotent: client sends `clientToken`; the deterministic reading id
  `<vehicleId>_<token>` makes retries no-ops inside a Firestore transaction.

## Maintenance schedule engine (pure)

`computeScheduleStatus(input)` → `{ status, nextDueOdometerKm, nextDueDate,
remainingKm, remainingDays, odometerState, timeState, computed }`.

- Statuses: `NOT_CONFIGURED | OK | DUE_SOON | DUE | OVERDUE`.
- Per-limit states; overall = worst (OVERDUE > DUE > DUE_SOON > OK).
- Odometer: `nextDue = lastServiceOdometerKm + intervalKm`;
  `current > nextDue` → OVERDUE; `== nextDue` → DUE;
  `>= nextDue − dueSoonKm` → DUE_SOON; else OK.
- Time: same shape on dates (day precision, UTC).
- `NOT_CONFIGURED` when a configured interval lacks its baseline (setup
  incomplete) or nothing is configured.
- Only a recorded `ServiceRecord` (via work-order completion or direct
  `service:record`) resets a schedule — never a reminder acknowledgement.

## Work-order lifecycle

`OPEN →(start) IN_PROGRESS ⇄(wait/continue) WAITING →(complete) COMPLETED →(verify*) → CLOSED →(reopen) OPEN`

- `complete` requires completion data (date, odometer-or-exemption reason,
  work performed, responsible user) — enforced server-side.
- Completion is one idempotent transaction: ServiceRecord (once) + schedule
  resets (only linked task schedules) + issue resolution update + odometer
  reading (source `SERVICE_COMPLETION`).
- Completing never releases a safety hold. `vehicle:release` re-checks open
  critical issues and mandatory documents.

## Safety flow

Critical issue or failed critical inspection item → server applies
`SAFETY_HOLD` (actor = system via submitting user's request; audited).
Release: `vehicle:release` + reason + server check of open critical issues.

## Expense model (no approval)

`RECORDED → VOID(reason, actor)`. Fuel entries create/reference one canonical
expense; reports count each pesewa once via `expenseId`.
