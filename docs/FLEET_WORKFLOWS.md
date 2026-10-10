# Fleet Workflows

End-to-end operational workflows of the Fleet Management System, grounded in
the real code paths. Each workflow lists the API calls, the permission gates,
the transactional invariants and the failure modes the system must enforce.
Terminology and entities follow [FLEET_DOMAIN_MODEL.md](./FLEET_DOMAIN_MODEL.md);
permission names come from `src/lib/auth/permissions.ts`.

All endpoints are under `/api/v1`, require a cookie session, and every
state-changing call also requires `origin` + `x-csrf-token` headers.

---

## 0. Request pipeline (all lifecycle actions)

Every mutation in the app shares one server-side choreography
(`src/lib/api/action.ts` unless noted):

1. CSRF + origin check (`assertCsrfAndOrigin`).
2. Authenticated context (`requireAuthContext`) — opaque Firestore session.
3. Resolve the named action against the entity's action map — unknown actions
   are `400 UNKNOWN_ACTION`, never silently ignored.
4. `requirePermission(action.permission)` — denied → `403 FORBIDDEN`.
5. Load the entity — missing → `404`.
6. Validate the current state against `from` states — invalid → `409 CONFLICT`
   with the reachable states listed.
7. Entity-specific invariant hooks (`assertAllowed`).
8. Apply the transition (one Firestore write(s) set) + audit event
   (`before`/`after` status, actor, reason, request id).

Retries are safe because state transitions are idempotent by nature
(applying `start` twice → second is a 409, not a double-apply), and the
documented idempotent writes use deterministic ids / `clientToken`s.

---

## 1. Defect capture → repair → release (the core loop)

This is the primary accountability flow. It is *audit-first*: nothing can be
repaired without a persistent report behind it, and a vehicle cannot return
to service while critical defects are unresolved.

### 1.1 Report an issue (driver/any employee)

```
POST /reports                      { vehicleId, title, description, severity }
```

- Any authenticated employee with `report:create` can report (drivers do this
  from their workspace). The issue is persisted as a `VehicleIssue` in
  `maintenanceReports` (collection name retained for audit continuity).
- State: `OPEN`. Severity `CRITICAL` automatically lifts a vehicle to
  `SAFETY_HOLD` and raises a notification (§1.5).

### 1.2 Triage (operations)

```
POST /reports/:id/status           { action: "triage" }
```

- `report:triage` (OPERATIONS). `OPEN → TRIAGED`, exactly once (409 on retry).
- Triaging does not itself start repairs — it is an ownership handover.

### 1.3 Create the work order (maintenance)

```
POST /reports/:id/work-order       { priority, description }
```

- `work_order:create` (MAINTENANCE). One work order per issue — a second
  attempt is `409 CONFLICT`. The issue↔work-order link is written in the same
  transaction, so `issueIds` on the work order is authoritative.
- Work orders can also be created directly (`POST /work-orders`) for
  preventive tasks with no preceding defect report (e.g. PM from a schedule).

### 1.4 Execute (work-order pipeline)

```
POST /work-orders/:id/status       { action: "start" }        → IN_PROGRESS
POST /work-orders/:id/status       { action: "wait", reason } → WAITING
POST /work-orders/:id/status       { action: "resume" }       → IN_PROGRESS
POST /work-orders/:id/complete     { workPerformed, odometerKm, scheduleIds?,
                                     resolvedIssueIds?, providerName?, notes? }
POST /work-orders/:id/status       { action: "verify" }       → VERIFIED
POST /work-orders/:id/status       { action: "close" }        → CLOSED
POST /work-orders/:id/status       { action: "reopen" }       → OPEN
```

- `wait` requires a reason; `WAITING ⇄ IN_PROGRESS` are the only reversible
  working states.
- **Completion is a dedicated, evidence-gated endpoint** — it is *not* an
  action-map action, because it writes more than a status flag:
  - requires `workPerformed` (free text) and a whole `odometerKm`;
  - runs `completeWorkOrder` in ONE Firestore transaction:
    immutable `ServiceRecord` + work order → `COMPLETED`
    + named `maintenanceSchedules` baselines (`lastServiceOdometerKm`,
    `lastServiceDate`) reset **only for the schedules listed** — un-named PM
    tasks keep their old baseline and remain due;
    + linked issues → `CLOSED` with `resolvedByWorkOrderId`;
  - then records the completion odometer through the ledger
    (`source: SERVICE_COMPLETION`, `clientToken: svc:<woId>` → idempotent);
  - replays are idempotent: a completed/verified/closed work order returns
    the existing service record with `duplicate: true`.
- Completion **never releases a safety hold** — releasing is a separate,
  permission-gated `vehicle:release` action (§1.5).
- `verify` (`work_order:verify`, OPERATIONS/FINANCE) and `close` complete the
  QA loop; `reopen` (from `CLOSED`) clears downstream evidence links on the
  work order (the service record remains as history).

### 1.5 Safety hold and release

```
POST /vehicles/:id/status          { action: "safety_hold", reason } → SAFETY_HOLD
POST /vehicles/:id/status          { action: "release" }             → ACTIVE
POST /vehicles/:id/status          { action: "send_to_workshop" }    → IN_SERVICE
POST /vehicles/:id/status          { action: "return_to_service" }   → ACTIVE
```

- `safety_hold` (any `vehicle:status:update` role) records the reason, actor,
  applied-at, and the triggering `issueId` (when created from a CRITICAL
  report/inspection failure).
- **`release` requires the dedicated `vehicle:release` permission which no
  role holds by default**; release is granted via a custom role/policy when
  the fleet owner decides. The route re-checks open critical issues before
  clearing the hold.
- `archive` requires `vehicle:archive` and is blocked while open work orders
  exist (`countOpenWorkOrders > 0` → 409 with the count).

---

## 2. Odometer ledger

PATCHing `mileage` on a vehicle is rejected (`400`, "use the ledger"). The
vehicle's `odometerKm` is a **projection** recomputed only by transactional
ledger writes.

```
GET  /vehicles/:id/odometer        → readings (newest effective first) + projection
POST /vehicles/:id/odometer        { km, source, effectiveAt?, clientToken?, … }
POST /odometer/:id/correct         { correctedKm, reason }   (odometer:correct)
GET  /odometer/recent              → recent readings across the fleet
```

- `odometer:record` (DRIVER/OPERATIONS/MAINTENANCE/…). Live sources
  (`TRIP_START`, `TRIP_END`, `PRE_TRIP_INSPECTION`, `POST_TRIP_INSPECTION`,
  `FUEL_PURCHASE`, `SERVICE_COMPLETION`, `MANUAL_ENTRY`) must be ≥ current
  projection — a decrease is `409 DECREASE_REJECTED` and directs the caller to
  the correction workflow (§2 of the domain model).
- Retries are no-ops: `clientToken` derives a deterministic reading id
  `<vehicleId>_<token>`; the write is inside a transaction.
- Corrections (`odometer:correct`) supersede — never delete — the original
  reading and require a reason; the projection is recomputed from the highest
  accepted reading (§5 of the requirements).
- `HISTORICAL_IMPORT` readings never raise the projection; they are validated
  against their chronological neighbours and flagged (`FLAGGED` +
  `conflictNote`) instead.

---

## 3. Preventive maintenance engine

- Every vehicle runs against `maintenanceTemplates` → per-vehicle
  `maintenanceSchedules` (`intervalKm`, `dueSoonKm`, time interval, and a
  baseline `lastServiceOdometerKm` / `lastServiceDate`).
- `computeScheduleStatus` (pure, unit-tested) derives per-limit states and the
  overall worst state: `OVERDUE > DUE > DUE_SOON > OK`; oil-change example —
  last service 79,250 km, interval 5,000 km, due-soon 500 km → next due
  **84,250 km** exactly; DUE_SOON at 83,750 km.
- Only a recorded `ServiceRecord` (work-order completion or
  `POST /service-records` with `service:record`) resets a baseline — reminder
  acknowledgements never do.
- Standard fixtures (`oil-change` 5,000 km / 500 km) are seeded by the
  migration/bootstrap scripts.

---

## 4. Inspections (pre-trip / return)

```
POST /inspections                  { vehicleId, type: PRE_TRIP|RETURN,
                                     odometerKm, items: [ {item, passed, note} ],
                                     assignmentId? }
```

- Drivers complete a structured checklist against the vehicle
  (`inspection:create`). The inspection odometer flows into the ledger with a
  source matching the type.
- A failure on a CRITICAL inspection item **auto-creates one issue per failed
  critical item** and lifts the vehicle to `SAFETY_HOLD` (with the issue id
  recorded on the hold). Completion of repairs never releases the hold — see
  §1.5.

---

## 5. Assignments and trip distance

```
POST /assignments                  { vehicleId, driverId, purpose, {startOdometerKm} }
POST /assignments/:id/end          { endOdometerKm, notes? }
```

- `assignment:create` (OPERATIONS) requires an ACTIVE vehicle with no open
  critical issues; starting records the odometer through the ledger
  (`TRIP_START`, deterministic id per assignment).
- Ending (`assignment:end`) requires the end reading ≥ the recorded start and
  ≥ the ledger projection — a decrease is mapped to
  `409 DECREASE_REJECTED`. **Trip distance = end − start** (the only
  definition; never a delta from a stale projection). Only drivers/ops with
  the active assignment may run a trip (active assignment is single-active per
  driver).
- Ending a non-started or already-ended assignment is `409`; a driver cannot
  hold two active assignments.

---

## 6. Fuel

```
POST /fuel                         { vehicleId, odometerKm, litres, pricePerLitre, … }
```

- A fuel entry creates its **canonical `Expense`** (category FUEL, integer
  pesewas via `toPesewas`) in the same transaction; the expense id is linked
  back on the fuel entry. Money is never figured twice.
- Consumption is only recorded on **full-tank purchases** (fuel level
  semantics); the odometer flows into the ledger (`FUEL_PURCHASE`).
- Expenses observe the lifecycle `RECORDED → VOID` only
  (`POST /expenses/:id/status { action: "void", reason }`, `expense:void`,
  FINANCE). There is **no in-app approval**; voiding is permanent-audited and
  never deletes. Export (`GET /expenses/export`) requires `expense:export`.

---

## 7. Documents

```
POST /documents                    { vehicleId, kind, fileUrl, expiresAt? }
PATCH /documents/:id               { name?, expiresAt?, notes?, status? }
```

- Upload is permission-gated (`document:upload`, OPERATIONS/MAINTENANCE);
  management (`document:manage`) adds rename/expiry handling.
- Derived states: `VALID | EXPIRING_SOON | EXPIRED | MISSING` from
  `expiresAt` (30-day window). Vehicles with a missing/expired **mandatory**
  document kind cannot be assigned; a driver starting an assignment on such a
  vehicle is blocked with a 409 naming the document.

---

## 8. Notifications and the daily reminder cron

```
GET  /api/v1/notifications                 → unread first, pageable
POST /api/v1/notifications/:id/read        → mark read
GET  /api/v1/cron/reminders                (CRON_SECRET bearer, Vercel Cron)
POST /api/v1/cron/reminders                (same CRON_SECRET gate; manual/internal)
```

- Critical events (critical report, hold applied, expiry, successful
  completion, …) raise in-app notifications. Each notification carries a
  `dedupeKey`; creation is idempotent via a transaction on the key — reruns of
  the cron create nothing duplicate.
- `vercel.json` schedules `GET /api/v1/cron/reminders` daily at 07:00 UTC.
  Vercel Cron invokes scheduled endpoints with HTTP GET, so the route exports
  `GET`; a `POST` handler is kept for deliberate manual/internal invocation and
  is guarded by the identical secret check. Secret comparison is constant-time
  and the endpoint fails closed when `CRON_SECRET` is unset.
  The cron computes, in one pass:
  - **PM reminders** bucketed by km-band/day from `computeScheduleStatus`
    (DUE_SOON/DUE/OVERDUE → owners + operations);
  - **document expiry** reminders (EXPIRING_SOON/EXPIRED);
  - **assignment** reminders (started-but-not-ended drivers);
  - per-role batches so drivers only see their own vehicle reminders.
- `dedupeKey` derives from {kind, entityId, bucket} so a re-run on the same
  day is a no-op, while a later day produces a fresh reminder.

---

## 9. Incidents (restricted)

```json
POST /incidents                       { vehicleId, type, severity, description, location?, occurredAt? }
GET  /incidents?vehicleId=            → incident:read:all sees all; otherwise your own
POST /incidents/:id/status            { action: "start_review" } | { action: "resolve", resolution }
GET  /incidents/:id                   → reporter or incident:read:all
```

- Breakdown / accident / passenger / security events. Any employee with
  `incident:create` (drivers included) reports; the event is dated by
  `occurredAt` (validated not to be in the future) and audited
  (`incident.created`).
- Ownership scoping: without `incident:read:all`, list/get return only
  incidents the caller reported — the same fail-closed pattern as reports.
- The review lifecycle `OPEN → UNDER_REVIEW → RESOLVED` is `incident:manage`-only
  (OPERATIONS). **Resolving requires a resolution note** (same accountability
  doctrine as issue closure) and records `resolvedByUserId` + `resolvedAt` in
  the audit event (`incident.updated`).

---

## 10. Scenario walkthroughs (the mandated end-to-end checks)

These are asserted by `scripts/e2e-accountability.mjs` (40) and
`scripts/e2e-operations.mjs` (25) against live Firestore:

- **A — Real report**: driver submits a CRITICAL report → vehicle held;
  MAINTENANCE creates work order, starts, completes with evidence (schedule
  baselines: only named ones reset; oil-change untouched), verifies, closes;
  release is denied to MAINTENANCE (`403 vehicle:release`); audit rows exist.
- **B — Mileage boundaries**: `validateReading` rejects decreases
  (`DECREASE_REJECTED`), accepts equal/higher, rejects non-integer/negative/
  absurd values; correction supersedes and recomputes the projection;
  historical import conflicts reject.
- **C — Oil-change boundary**: 84,250 km next due; OK at 83,749, DUE_SOON at
  83,750, DUE at 84,250 (unit-tested in `maintenance.test.ts`).
- **D — Inspection safety net**: failed critical item → auto issue +
  SAFETY_HOLD with issueId; completed repairs never release the hold.
- **E — Assignment/trip distance**: start with odometer → end with higher
  reading; trip = end − start; decrease → 409.
- **F — Fuel**: canonical Expense created; consumption only on full tank.
- **G — Documents**: missing mandatory registration document blocks
  assignment start with 409.
- **H — Notifications**: cron run with CRON_SECRET; dedupe keys make reruns
  no-ops; unread list + read marking work per user.
- **I — Work-order idempotency**: completion replay returns `duplicate: true`
  with the same service record; reopen+recomplete creates a fresh record.
- **J — Incident restrictions**: drivers report and read only their own;
  resolving without a resolution note is 400; OPERATIONS reviews/resolves.

---

## 11. Failure-mode invariants (enforced, not aspirational)

| Invariant | Enforced by |
| --- | --- |
| No state change without CSRF + origin + permission | `assertCsrfAndOrigin`, `requirePermission` on every mutation |
| Unknown actions are rejected, not ignored | action-map `resolveAction` → `400 UNKNOWN_ACTION` |
| States move only through action/complete endpoints | generic PATCH bodies cannot include `status` |
| Odometer never decreases silently | ledger transaction → `409 DECREASE_REJECTED` |
| Trip distance is always end − start | assignment end reads both ledger readings |
| No repair without a traceable record | work-order completion evidence gate + immutable ServiceRecord |
| No release from a hold by same-party fixers | `vehicle:release` not granted to any default role; re-checks open critical issues |
| Money recorded once, never double-counted | integer pesewas; fuel → canonical Expense in one transaction |
| No expense "approval" drift | expenses only `RECORDED → VOID` (FINANCE-only, reason required) |
| Reminders/journaling survive reruns | `dedupeKey` idempotency + Firestore transactions |
| Write payloads never fail on `undefined` | `definedOnly` stripping in every repo write path |