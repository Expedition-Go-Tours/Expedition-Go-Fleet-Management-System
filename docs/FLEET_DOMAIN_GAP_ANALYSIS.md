# Fleet Domain Implementation Gap Analysis

Audited 2026-10-09 against the code at commit `cc26bcd` (Phase 4). Status
labels in `README.md` were verified against code, tests, and live E2E runs —
not trusted at face value.

## 1. Implemented and tested

| Area | Evidence |
| --- | --- |
| Opaque Firestore sessions, revocation-per-request, CSRF, temp-password onboarding | `scripts/e2e-auth.mjs` 17/17 live |
| RBAC permission catalog + role matrix + guards | 62 unit tests, `e2e-fleet.mjs` 44/44 |
| Vehicle CRUD + status action map (safety hold, release permission-gated) | `lifecycle.test.ts`, fleet E2E |
| Maintenance reports + work orders with strict lifecycle + audit | fleet E2E |
| Providers CRUD, audit log read (self-audited) | fleet E2E |
| Users admin (invite/roles/disable, last-admin invariant) | `e2e-auth.mjs` |
| App shell, sign-in, dashboard, fleet screens | Playwright + build |

## 2. Implemented only partially

| Gap | Detail |
| --- | --- |
| Vehicle profile | Only reg/make/model/year/type/vin/mileage. No capacity, fuel type, ownership class, acquired/in-service dates. Mileage is a freely PATCHable integer — no ledger, no history, no corrections. |
| Reports | No reference number, category, safety flag, immobilization flag, odometer capture, evidence, follow-up comments, or driver "My Reports" view. Report→work-order is 1:1 only (spec demands many-to-many). |
| Work orders | No completion evidence gate (any state change suffices), no completion odometer/date, no parts/labour, no provider link, no waiting/blocked or verification states, no number. |
| Expenses | Lifecycle `PENDING→APPROVED→PAID` with in-app approve/pay actions — **conflicts** with the requirement that approval happens outside this system. No supplier, receipt, or work-order-cost linkage semantics. |
| Audit | Captures actor/entity/before-after for state changes; not yet wired to odometer, service, inspection, assignment, document events. |
| Firestore access | Equality-filter + in-memory sort everywhere; no compound indexes, no pagination. Acceptable only as a temporary state. |
| Vehicle detail | Flat page — no tabs, no history, no timeline, no documents section. |

## 3. Documented but not implemented end-to-end

- **Preventive maintenance**: no templates, schedules, due-calculation engine,
  service records, or next-due projections. The oil-change example in the
  requirements cannot be computed by any current code.
- **Odometer ledger**: `mileageEntries` collection name exists in
  `collections.ts` but nothing writes to it.
- **Trips/assignments, inspections, incidents, fuel entries, vehicle
  documents, notifications, in-app reminders**: no domain model, no repos, no
  routes, no UI. `vercel.json` has **no cron configuration**.
- **Cloudflare R2**: decided in `ARCHITECTURE.md`, zero integration code.
- **Reports/exports/dashboard**: dashboard shows counts only; no due/overdue
  report, no cost-per-km, no CSV beyond the expense stub.
- **Firestore rules file**: none in repo (default-deny is console-only).

## 4. Missing entities, calculations, permissions, tests

New entities: `OdometerReading`, `MaintenanceTemplate`, `MaintenanceSchedule`,
`ServiceRecord`, `VehicleAssignment`, `TripLog` (folded into assignment),
`Inspection`, `VehicleIssue` (upgraded report), `IncidentReport`,
`FuelEntry`, `VehicleDocument`, `Notification`, work-order↔issue link docs.

Missing calculations: schedule due/overdue engine (km + time, first-limit-wins
precedence), trip distance from accepted readings, fuel consumption
(full-tank-to-full-tank), cost-per-km guards, effective vehicle availability
(status + holds + documents + open critical issues).

Missing permissions: `odometer:record|correct|import`, `assignment:*`,
`inspection:submit`, `issue:triage|close`, `incident:*`, `service:record`,
`schedule:manage`, `document:upload`, `fuel:create|read`, `work_order:wait|verify`.

Missing tests: all mandated oil-change boundary tests, odometer
monotonicity/correction tests, critical-defect→safety-hold workflow tests,
double-submit/idempotency tests.

## 5. Conflicts with the business requirements

1. **Expense approval lifecycle** (`APPROVED` state, `approve`/`mark_paid`
   actions, approval UI) — approval happens outside the system. Must be
   redesigned to record/void only.
2. **`PATCH /vehicles/[id]` mileage** — free-form editing conflicts with the
   accountable odometer ledger. Must be removed in favour of recorded readings.
3. **Report auto-activation semantics** — none, but reports currently cannot
   carry safety-critical information or trigger a safety hold; a completed
   work order currently implies nothing about release, which is correct and
   must be preserved.
4. **In-memory sorting** — explicitly disallowed as the production strategy.

## Resolution

`maintenanceReports` remains the persisted collection for the upgraded
`VehicleIssue` entity (audit history preserved; no destructive migration).
`mileage` on vehicles becomes a derived projection (`odometerKm`) recomputed
only by trusted server logic from the `odometerReadings` ledger. The expense
lifecycle is replaced by `RECORDED → VOID` with mandatory void reason.
