# UI/UX and Release Audit — Expedition Go Tours Fleet Management

> Audit performed against `main` @ `5442eaf` (Phase G shipped). Every statement
> below was verified in source, not taken from documentation. Items marked
> [FIX] are remediated as part of the UI/UX overhaul that this audit introduces.

---

## 1. Inventory of routes and their state

| Route | Exists | Renders real data | Notes found during the audit |
|---|---|---|---|
| `/` (dashboard) | Yes | Yes | 4 static stat cells + 2 lists + safety-hold card. Not role-aware, no drill-down KPIs, no maintenance/action data. |
| `/workspace` | Yes | Yes | Driver trip + issues + report form + notifications. No inspection prompts, no odometer-entry UI beyond end-trip, no breakdown/incident shortcut. |
| `/vehicles` | Yes | Yes | Flat list beside an inline registration form. No search/filter/sort/pagination. **Form sends retired `mileage` field — the API only accepts `odometerKm`, so the baseline is silently lost.** [FIX] |
| `/vehicles/[id]` | Yes | Yes | Tabs work, but: **maintenance passes `intervalDays: null` and `lastServiceDate` as a string**, so time-based tasks are never evaluated; **document state is `mandatory \|\| !expiryDate ? "MISSING" : "VALID"`, hiding valid uploaded evidence**; issues/work orders/service records are **not clickable**. [FIX] |
| `/reports` | Yes | Yes | List + side form. Items not clickable to any detail route; no filters/search. |
| `/reports/[id]` | **No** | — | Missing dedicated issue detail. [FIX — create] |
| `/work-orders` | Yes | Yes | List + create form. Items not clickable; **no UI at all for evidence-gated completion** (the domain requires `workPerformed` + `odometerKm` via the dedicated `/complete` endpoint); the list's "Mark complete" label is dead (not in the action map). [FIX] |
| `/work-orders/[id]` | **No** | — | Missing work-order detail (lifecycle, evidence, service-record link, costs). [FIX — create] |
| `/incidents` | Yes | Yes | Restricted list + report form + resolve. No detail route. |
| `/incidents/[id]` | **No** | — | Missing incident detail. [FIX — create] |
| `/expenses` | Yes | Yes | List + form. **Form requires `workOrderId`, contradicting the domain (vehicle is the primary association; work order/service/fuel are optional).** Obsolete `approve`/`mark_paid` labels remain in the code. No vehicle column/link, no filters, no date range. [FIX] |
| `/fuel` | **No** | — | Only reachable via vehicle tabs. No fleet-level spending/consumption view. [FIX — create] |
| `/documents` | **No** | — | Only reachable via vehicle tabs, and the mapping is wrong (above). [FIX — create] |
| `/maintenance` | **No** | — | Schedules are only visible per vehicle; no fleet-wide due/overdue view for the maintenance dashboard KPIs. [FIX — create] |
| `/notifications` | **No** | — | Notifications surface only inside the workspace. [FIX — create] |
| `/users` | Yes | Yes | Basic list + editor + invite. Fine functionally; can move to table layout. |
| `/audit` | Yes | Yes | Flat 200-row dump; no entity filter/grouping, no reuse. |
| `/styleguide` | Yes | — | Displays current tokens; to be updated with the new system. |
| `/sign-in`, `/change-password` | Yes | Yes | Functional; heading text is asserted by `e2e/home.spec.ts` ("Fleet maintenance") and must be preserved or the test updated. |

## 2. Verified cross-cutting defects

1. **Maintenance time-interval integration** — `vehicles/[id]/page.tsx` calls
   `computeScheduleStatus` with `intervalDays: null`, `dueSoonDays` omitted, and
   `lastServiceDate` passed as an already-formatted string. The engine requires
   a `Date`. Consequence: a time-based task is never overdue/due; every task
   shows as if km-only. [FIX]
2. **Document status mapping** — the vehicle tabs map `status = d.mandatory ||
   !d.expiryDate ? "MISSING" : "VALID"`. A mandatory INSURANCE with a valid
   expiry date and uploaded `fileKey` renders MISSING. The domain already has
   `documentState()` (VALID / EXPIRING_SOON / EXPIRED / MISSING) and the
   documents API returns `state` — the UI ignores both. Evidence presence must be
   surfaced separately from expiry state. [FIX]
3. **Expense form** — requires a work order; domain allows vehicle-only
   expenses. Also, the expenses page labels map contains `approve`/`mark_paid`
   which can never render (the lifecycle is RECORDED → VOID only) — dead UI. [FIX]
4. **Vehicle form** — sends `mileage`; the API reads `odometerKm`. A >0 baseline
   entered at registration is dropped (vehicle defaults to 0 km). Also the form
   is squeezed beside the list. [FIX]
5. **No evidence-gated completion UI** — the work-order completion endpoint
   exists with its `CompletionError` contract, but no screen collects
   `workPerformed` + `odometerKm`. [FIX]
6. **Record connectivity** — issue lists, work-order lists, vehicle-tab rows,
   expenses, service records and assignments are plain text rows, not links.
   With no detail routes for issues/work orders, "open the record" is
   impossible today. [FIX]
7. **Global search** — absent. [FIX — add `/api/v1/search` + header component]
8. **Notifications centre and header unread count** — absent; notifications
   only live in the workspace. [FIX]
9. **Typography/scale mismatch** — every page renders a 40px display heading
   with `-0.03em` tracking; card titles are 11px uppercase mono labels. Fine for
   a marketing site (see `docs/DESIGN_SYSTEM.md`), wrong for a data-dense
   operations tool. [FIX — operational type scale]
10. **App shell** — flat, ungrouped navigation; no icons; no search; no
    notification bell; mobile "menu" is a dropdown, not a drawer; no
    breadcrumbs. [FIX]

## 3. What is already sound (do not regress)

- All mutations stay server-side through `/api/v1/*` with CSRF + origin checks,
  permission checks before state validation, and `makeActionHandler` audit
  events. The redesign must not bypass any of it.
- Odometer ledger (transactional projection, corrections, idempotent tokens),
  evidence-gated work-order completion, safety-hold invariants, incident
  read-realm restrictions and RECORDED→VOID expense lifecycle are correct and
  tested; the UI layer must merely *use* them correctly.
- Repos deliberately avoid composite indexes (equality filters + in-memory
  sort, documented ~2k threshold). UI pagination/filtering must reuse these
  same query shapes and never silently present a partial first page as the
  full set without a "showing first N" indication.
- Existing `scripts/e2e-*.mjs` suites (40/25/17/54 checks) and unit tests
  (107) were green pre-overhaul; they exercise the API, so the redesign must
  keep them green.

## 4. Data-freshness rules honoured by the redesign

- Every KPI count is derived at request time from Firestore through the repos
  (never hardcoded, never cached cron labels). Calculation rules are documented
  in the dashboard module.
- "Available" = `ACTIVE` status **and** no safety hold **and** no open critical
  issue **and** no active assignment — derived, not just the status field.
- Fuel efficiency is shown only when two consecutive full-tank fill-ups make a
  defensible computation (same rule as the fuel API's `computeConsumption`).

## 5. Fix/slice map (aligned with the brief's 15 sections)

| Slice | Work | Defects closed |
|---|---|---|
| 1 | Design system, app shell, grouped nav, page headers, shared data components, mobile layout | 9, 10 |
| 2 | Dashboard, vehicle list, vehicle profile; maintenance/document correctness | 1, 2, 4, 7 (vehicles + dashboard) |
| 3 | Reports/work-orders/incidents lists + dedicated detail routes, connected navigation | 5, 6 |
| 4 | Driver workspace (mobile-first), trip/odometer entry, inspection prompts, report follow-up | 6 (workspace) |
| 5 | Maintenance schedules page, expenses, fuel, documents pages | 3, 1, 2 (pages) |
| 6 | Search, filters, pagination, notification centre, timelines, export | 7, 8 |
| 7 | Accessibility/responsive QA, security regression, docs, production build | 9 + release checklist |

## 6. Outstanding production items (already known, unchanged by this work)

- `REQUIRE_MFA=false` until Firebase TOTP is enabled; weak admin password to be
  changed; `migrate-v1.mjs` written but not run against live data; R2 signed-URL
  document-upload end-to-end not live-verified; Vercel cron needs real
  deployment to confirm. These are tracked in the release checklist in
  `README.md` and are **not** part of this UI overhaul.