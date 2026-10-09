# Architecture & Decisions

This document records the decisions agreed for the Expedition Go Tours Fleet
Management System. It is the quickest way to get up to speed; the binding detail
lives in [`AUTHENTICATION_AUTHORIZATION.md`](./AUTHENTICATION_AUTHORIZATION.md).

## Product constraints

- **Internal only.** No marketing site, homepage, about/services/contact pages.
  The design language applies to the app shell, sign-in, and dashboard.
- **Invite only.** There is no public sign-up. Staff are invited and transition
  `INVITED → ACTIVE` via a single-use Firebase action link.
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

State changes go through **explicit action endpoints** — e.g.
`POST /api/v1/vehicles/:id/release`, `/work-orders/:id/complete`,
`/expenses/:id/void` — never a generic `PATCH { status }`. Every state change is
written to the audit log.

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
`serviceHistory`, `notifications`, `auditLogs`.

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
| 5     | Scheduled maintenance reminders (Vercel Cron)  |
| 6     | Hardening (CSP, rate limiting, observability)  |
