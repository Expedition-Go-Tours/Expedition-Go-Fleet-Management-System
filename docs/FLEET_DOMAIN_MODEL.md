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
| `ServiceRecord` | `serviceRecords` | Work actually completed (correctable; ADMIN deletion is audited with a full snapshot) |
| `VehicleIssue` | `maintenanceReports` | Reported defect + full report history (collection name kept for audit continuity) |
| `IncidentReport` | `incidentReports` | Breakdown/accident/passenger events (restricted) |
| `WorkOrder` | `workOrders` | Repair execution workflow |
| `WorkOrderIssueLink` | `workOrderIssues` | Many-to-many issue↔work-order links |
| `VehicleAssignment` | `assignments` | Who used which vehicle, when, for what (trip/journey) |
| `Inspection` | `inspections` | Structured pre-trip/return checklist results |
| `Expense` | `expenses` | Recorded financial cost (stored PENDING, presented as Recorded) |
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
- A direct service log may omit the odometer. The record then stores
  `odometerKm: null` (never `0`) and writes no ledger entry; the schedule
  baseline falls back to the vehicle's last accepted reading, so the next due
  point can move earlier but never later.

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

## Incident lifecycle (restricted)

`OPEN →(start_review) UNDER_REVIEW →(resolve) RESOLVED`; `OPEN →(resolve) RESOLVED`

- Anyone with `incident:create` reports; reads are own-only unless the user
  holds `incident:read:all`; the review lifecycle is `incident:manage`-only
  (OPERATIONS).
- Resolving requires a resolution note; actor + time are recorded on the
  incident and in `incident.updated` audit events. Status is the only
  action-gated field — descriptive fields edit via `incident:manage` PATCH.

## Expense model (recorded in-app; approval is external)

The app records; approval is an **external decision that does not happen in
this app**. Statuses `PENDING → APPROVED | REJECTED` remain only as legacy
storage compatibility: a newly recorded cost is stored as `PENDING` and shown
as **Recorded**, never as "awaiting approval". The normal lifecycle action is
`PENDING | APPROVED → VOID(reason, actor)` behind `expense:void`, available
immediately after recording. A separate ADMIN-only `expense:delete` can
permanently remove an expense with a written reason and a full `expense.deleted`
audit snapshot; it is reserved for data that must not remain, not ordinary
corrections. The former `approve`/`reject` API actions were
removed with the unused `expense:approve` permission; no external consumer
existed. Reports count `PENDING` and `APPROVED` only, so legacy rows keep
their historical meaning. Fuel entries create/reference one canonical
expense; reports count each pesewa once via `expenseId`. The fuel odometer and
litres are optional: an office-paid fill-up may only know the amount. It still
records its cost, writes no odometer reading, and breaks the efficiency chain
rather than inflating a later km/l figure.

Service completions and direct service logs may each carry at most one linked
MAINTENANCE expense. The expense id is deterministic
(`svc_<serviceRecordId>`), and the service record stores the requested cost
as intent until the expense is linked, so a retry after a partial failure
finishes the cost instead of silently losing it. A direct log may itemise the
cost as workmanship plus named parts (`labourCostMinor`, `costItems`): the
server sums the parts into `repairCostMinor`, which stays the authoritative
total, and the linked expense carries that total.

Both fuel entries and service records can carry an optional free-text
`paidTo` (≤200 characters) — the person who received the payment. It is
trimmed at write time (blank means not recorded), stored on the source record,
and mirrored onto the canonical `Expense` in the same request. It is distinct
from `supplierName`, which stays the station/garage business, and is shown in
the fuel ledger, the expense ledger and the CSV export.

Completed service records can also be corrected by operations/admin: completion
date, label, work performed, provider, technician, payee, notes and the cost
breakdown are editable, while the vehicle and odometer stay immutable. A date
correction moves the schedules this record last reset and the linked expense
date; a cost correction updates the linked MAINTENANCE expense in the same
transaction. A work-order completion carries the corrected narrative and date
back to the work order. Money is never cleared silently — an existing cost must
be voided with a reason instead. Corrections are audited as
`service.corrected`.

An ADMIN can permanently delete a completed service record with
`service:delete` and a written reason. The linked MAINTENANCE expense(s) go with
it; schedules the record last reset lose their baseline and return to
`NOT_CONFIGURED`; odometer readings are kept as mileage history with the
service link cleared; a linked work order is kept with its service link
cleared. The full record and cleanup summary are audited as `service.deleted`.

Fuel purchases can be corrected by operations/admin: date, amount, fuel type,
station, payee and full-tank flag are editable, while the vehicle, odometer
link and recorder stay immutable. The linked expense is updated in the same
transaction and the correction is audited before/after. An ADMIN can
permanently delete a purchase (`fuel:delete`, written reason, `fuel.deleted`
audit): its canonical expense is deleted with it, while its odometer reading is
kept as mileage history and only loses the fuel link.
