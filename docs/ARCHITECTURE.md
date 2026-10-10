# Architecture & Decisions

This document records the decisions agreed for the Expedition Go Tours Fleet
Management System. It is the quickest way to get up to speed; the binding detail
lives in [`AUTHENTICATION_AUTHORIZATION.md`](./AUTHENTICATION_AUTHORIZATION.md).

## Product constraints

- **Internal only.** No marketing site, homepage, about/services/contact pages.
  The design language applies to the app shell, sign-in, and dashboard.
- **Invite-only.** There is no public sign-up. Staff are invited and transition
  `INVITED → ACTIVE` only after accepting their invite and setting their own
  password (see below).
- **Invite delivery is out-of-band.** No email provider: `POST /api/v1/users`
  creates the account and returns a one-time temporary password that the admin
  shares directly (phone/WhatsApp). The invitee must change it on first sign-in —
  enforced server-side via `mustChangePassword` on the user doc and a restricted
  session that can only call `POST /api/v1/auth/password`. Any password change
  revokes every session for that user and forces re-authentication (preserving
  the MFA-at-session-establishment policy).
- **In-app reminders only.** No email provider at MVP.

## Stack decisions

- **Next.js + TypeScript on Vercel** for both the UI and the API. Route handlers
  under `/api/v1/*` replace the Express layer proposed in the auth spec.
- **Firebase only.** Firebase Authentication, Cloud Firestore, and sessions. The
  auth spec's Redis (sessions) and PostgreSQL/Prisma (data) recommendations are
  **not** used at MVP — Firestore stores sessions and domain data. Do not
  reintroduce Redis without an explicit decision.
- **Object storage is Cloudflare R2** (S3-compatible), deferred to Phase 3.
  Firebase Storage would force the paid Blaze plan; R2 keeps the project on the
  free Spark plan with a 10 GB allowance and no egress fees.
- **Vercel Cron** drives scheduled maintenance reminders, keeping Firebase on the
  free tier. The cron endpoint is protected by `CRON_SECRET`.

## Authentication & sessions

- Browser uses the Firebase Auth **client SDK only to sign in**.
- On successful sign-in the server mints a **256-bit random opaque session
  token**. Only the token's **SHA-256 hash** is stored in Firestore.
- The token is set in an opaque cookie `__Host-egt_session`
  (`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`).
- **Every** protected request validates the session and checks revocation with
  **no caching**, so admin revocation takes effect on the next request.
- The Firebase **Admin SDK is server-side only**, never imported into client code.

## Authorization

Layered guards, applied in order:

1. `requireAuthenticatedUser`
2. `requirePermission('key')`
3. `authorizeResource(scope)`

State changes go through **explicit action endpoints** — a generic
`PATCH { status }` is rejected everywhere; states move only via
`POST /<entity>/{id}/status` with an `action` in the body, or the dedicated
`POST /work-orders/:id/complete` evidence endpoint (work-order completion
writes a service record + schedule resets, so it is not an action-map action).
Every state change is written to the audit log.

MFA (TOTP) is required for `ADMIN`, `MANAGER` and `FINANCE` roles.

## Data access

- All data flows through `/api/v1/*` using the Admin SDK.
- Firestore security rules are **default-deny**; the client SDK does not read
  Firestore or Storage directly.
- Role assignments live on the `users` doc (`roles: RoleKey[]`) as the
  authoritative source for authorization — read fresh on every request, never
  cached — while `userRoles` retains the assignment history for audit.
- Storage objects use randomized keys and are served through short-lived signed
  URLs issued only after the parent record has been authorized.

## Firestore collections

`users`, `roles`, `userRoles`, `sessions`, `invites`, `vehicles`,
`mileageEntries`, `maintenanceReports`, `workOrders`, `expenses`,
`serviceHistory`, `notifications`, `auditLogs`, `providers`.

## Firestore collections

`users`, `roles`, `userRoles`, `sessions`, `invites`, `vehicles`,
`odometerReadings` (+ `mileageEntries` deprecated alias), `maintenanceTemplates`,
`maintenanceSchedules`, `serviceRecords` (+ `serviceHistory` promoted alias),
`maintenanceReports` (persisted store for `VehicleIssue`), `incidentReports`,
`workOrders`, `workOrderIssues`, `assignments`, `inspections`, `expenses`,
`fuelEntries`, `vehicleDocuments`, `notifications`, `auditLogs`, `providers`.

## Fleet domain (Phases A–F)

- **Lifecycle state machines, explicit action endpoints.** Each entity's status
  changes only through `POST /<entity>/{id}/status` with an `action` in the
  body — never through PATCH (`status` in a PATCH body is rejected with a 400).
  Actions live in `src/lib/domain/*` as pure `ActionMap` definitions:
  `{ permission, from[], to }`. The generic handler
  (`src/lib/api/action.ts`) resolves the action → checks its permission →
  validates the source state (409 on invalid transitions) → applies → audits
  before/after. Covered by unit tests in `src/lib/domain/lifecycle.test.ts`.
- **Key invariants:**
  - Vehicle `SAFETY_HOLD → ACTIVE` requires the dedicated `vehicle:release`
    permission (no role has it by default); `ARCHIVED` is terminal; archiving
    is blocked while open work orders exist; the odometer ledger never
    decreases (corrections supersede, historical imports flag, never delete).
  - Work orders run the pipeline
    `OPEN → IN_PROGRESS ⇄ WAITING → COMPLETED → VERIFIED → CLOSED →(reopen) OPEN`;
    completion is evidence-gated (`workPerformed` + `odometerKm`) and
    idempotent per work order (replays return the existing service record).
  - Expenses follow `RECORDED → VOID` only — no in-app approval. Voiding
    requires a reason and is FINANCE-only (`expense:void`).
  - Report ownership: `report:read:own` scoping enforced in the list and
    get endpoints; `report:read:all` reads everything. Closing an issue
    requires a resolution, a duplicate link, or a not-actionable reason.
  - Inspections: failed critical items auto-create one issue per item and
    raise a safety hold; completion never releases the hold.
  - Trip distance = end − start ledger readings; decreasing end readings are
    `409 DECREASE_REJECTED`.
  - Fuel entries create the canonical `Expense` in one transaction; full-tank
    purchases only.
  - A vehicle with a missing/expired mandatory document cannot start an
    assignment (409 naming the document).
  - Incidents (breakdown/accident/passenger/security) are restricted:
    anyone with `incident:create` reports; `incident:read:all` reads all else
    own-only; review lifecycle `OPEN → UNDER_REVIEW → RESOLVED` is
    `incident:manage`-only and resolving requires a resolution note.
  - Notifications are idempotent per `dedupeKey`; the Vercel Cron
    (`vercel.json` → `GET /api/v1/cron/reminders`, `CRON_SECRET` bearer,
    daily 07:00 UTC) generates PM / document-expiry reminders. The route
    exports **GET** (Vercel Cron invokes scheduled paths with GET) and, for
    deliberate internal/manual invocation, **POST** — both gated by the same
    constant-time `CRON_SECRET` check.
- **Money is integer minor units** (`amountMinor`, GHS exponent 2). Creation
  accepts a decimal major-unit value and converts with string arithmetic via
  `toPesewas` — no floats ever reach the ledger.
- **OdometerLedger:** `Vehicle.odometerKm` is a projection of the highest
  accepted reading, written only by the transactional ledger recorder
  (`src/lib/repos/odometers.ts`). Mandated mileage boundaries are
  unit-tested in `odometer.test.ts`; the maintenance engine boundaries in
  `maintenance.test.ts`.
- **Queries are equality-filter + in-memory sort.** Firestore composite indexes
  are deliberately avoided at MVP: lists filter with single-field `where`s and
  sort/limit in memory (collections are small for an internal tool). If a
  collection grows past ~2k docs, add the composite index instead. No composite
  indexes are deployed (see section on data access).
- **Providers** (garages/vendors) are plain CRUD with an `active` flag —
  deactivated providers stay in history rather than being deleted.
- **Data migration:** `scripts/migrate-v1.mjs` is the idempotent forward
  migration (legacy `mileage` → odometer baseline reading, expense statuses
  → `RECORDED`/`VOID`, work-order status remap, `serviceHistory` promotion).
  Run with `--dry-run` first; it never deletes data.

## Deliverables verification

- **Mandated boundary tests** live in `src/lib/domain/*.test.ts` (maintenance
  oil-change 5,000/500 km boundaries, odometer ledger correctness, work-order
  completion evidence contract, lifecycle action maps, reminders idempotency).
- **Live scenario suites** run against a running dev server + real Firestore:
  `scripts/e2e-accountability.mjs` (40 checks), `scripts/e2e-operations.mjs`
  (25), `scripts/e2e-auth.mjs` (17), `scripts/e2e-fleet.mjs` (54 — vehicles,
  reports, work orders, expenses, incidents, providers, audit). Suites are
  independently seedable (Admin SDK) and self-cleaning.

## App shell & screens (Phase 4)

- **Route groups:** `(auth)` holds the pre-login screens (sign-in, change
  password) on a dark full-bleed layout; `(app)` holds the authenticated app
  behind a server-side layout guard that redirects to `/sign-in` (no session)
  or `/change-password` (restricted onboarding session). Every page inside
  `(app)` inherits the guard.
- **Session flow in the browser:** the Firebase client SDK signs in and hands
  its ID token to `POST /api/v1/auth/session`; the response sets the opaque
  cookie session and the client then **discards its Firebase auth state** — the
  cookie is authoritative. `src/lib/client/api.ts` attaches the CSRF header
  from the readable cookie and bounces to `/sign-in` on any 401.
- **Server components read via repos, mutations via the API.** List/detail
  pages call the Firestore repos directly (server-only, still behind
  `requireAuthContext` + permission checks); every mutation goes through the
  `/api/v1` endpoints from small client components (`StatusActions`,
  `CreateForm`, `InviteUserForm`, `RoleEditor`, `UserStatusButton`), so the
  audit trail and invariant checks always run.
- **Permission-aware nav + action visibility:** the app shell filters nav items
  by effective permissions, and each screen computes its visible action
  buttons from the same server-side `ActionMap` used by the API — the server
  re-checks regardless.
- **`REQUIRE_MFA` dev gate:** privileged-role MFA enforcement (spec §4.2) can
  be disabled with `REQUIRE_MFA=false` **only** while TOTP is not yet enabled
  in the Firebase console. It defaults to enforced and must stay enforced in
  production; the flag is documented in `.env.example` and the auth E2E reads
  it to pick the expected outcome.
- **Bootstrap/recovery script:** `scripts/create-admin.mjs` creates or updates
  an admin directly via the Admin SDK (used for the first account and for
  recovery if the last-admin invariant locks everyone out).

## Design system

- Full visual language applies to the app (not just marketing): black/white
  monochrome base, a single warm accent `#ff5500`, oversized tightly-tracked
  Manrope display type, mono micro-labels, generous spacing, hairline borders.
- **Adaptation:** the source design uses a viewport-proportional root font size
  for pixel-perfect marketing layouts. For a data-dense internal application we
  keep the browser-default 16px root and express the type scale in `rem`,
  preserving the visual character while protecting legibility and accessibility.
  See the header comment in `src/design/tokens.css`.

## Delivery phases

| Phase | Scope                                          |
| ----- | ---------------------------------------------- |
| 0     | Scaffold, design tokens, tooling, CI           |
| 1     | Auth core (invites, sessions, sign-in/out)     |
| 2     | RBAC, permission guards, audit logging         |
| 3     | Fleet domain (vehicles, work orders, expenses) |
| 4     | Dashboard & app shell                          |
| A     | Odometer ledger + preventive maintenance engine|
| B     | Repair workflow (work-order pipeline, completion evidence gate) |
| C     | Issue↔work-order ecosystem (report→issue→work-order→service→release) |
| D     | Assignments, trip distance, inspections (safety-hold net) |
| E–F   | Fuel (canonical Expense), documents (expiry gates), idempotent notifications + Vercel Cron reminders |
| G     | Incidents (restricted reports + review lifecycle); hardened indexes, responsive verification (open) |
| 5     | Scheduled maintenance reminders (Vercel Cron) — shipped with E–F |
| 6     | Hardening (CSP, rate limiting, observability)  |
