# Expedition Go Tours — Fleet Management System

Internal vehicle maintenance and fleet-management system for **Expedition Go Tours**.

Staff-only, invite-only access with role-based permissions, an immutable audit
trail, and scheduled maintenance reminders. There is no public or marketing
surface — the application ships the sign-in screen and the operations dashboard.

## Stack

| Concern        | Choice                                                                |
| -------------- | --------------------------------------------------------------------- |
| Framework      | Next.js 16 (App Router) + React 19 + TypeScript                       |
| Styling        | Tailwind CSS v4 + design tokens in `src/design/tokens.css`            |
| Fonts          | DM Sans (body) + Manrope (display), self-hosted via `next/font/local` |
| Auth           | Firebase Authentication (email/password, TOTP MFA)                    |
| Data           | Cloud Firestore (Admin SDK, server-only)                              |
| Files          | Cloudflare R2 (S3-compatible) via signed URLs — Phase 3               |
| Scheduled jobs | Vercel Cron → `/api/v1/cron/*`                                        |
| Hosting        | Vercel                                                                |
| Testing        | Vitest + Testing Library (unit), Playwright (e2e)                     |

## Getting started

Requires **Node 24** (see `.nvmrc`) and npm.

```bash
nvm use            # or ensure node >= 24
npm install
cp .env.example .env.local   # then fill in the Firebase values
npm run dev                  # http://localhost:3000
```

Firebase is not required to run the Phase 0 shell — the placeholder home page
renders without any environment variables.

## Scripts

| Script                 | Purpose                        |
| ---------------------- | ------------------------------ |
| `npm run dev`          | Start the dev server           |
| `npm run build`        | Production build               |
| `npm run start`        | Serve the production build     |
| `npm run lint`         | ESLint                         |
| `npm run typecheck`    | TypeScript, no emit            |
| `npm test`             | Unit tests (Vitest)            |
| `npm run test:watch`   | Unit tests in watch mode       |
| `npm run test:e2e`     | End-to-end tests (Playwright)  |
| `npm run format`       | Format with Prettier           |
| `npm run format:check` | Verify formatting (used in CI) |

Dev tools:

| Script                             | Purpose                                                    |
| ---------------------------------- | ---------------------------------------------------------- |
| `node scripts/verify-firebase.mjs` | Checks Admin SDK credentials against live Auth + Firestore |
| `node scripts/e2e-auth.mjs`        | End-to-end auth flow test (needs `npm run dev`)            |
| `node scripts/e2e-fleet.mjs`       | End-to-end fleet-domain test (needs `npm run dev`)         |
| `node scripts/e2e-accountability.mjs` | Ledger/hold/expense accountability test (needs `npm run dev`) |
| `node scripts/e2e-operations.mjs`  | Assignments, fuel, documents, inspections, cron (needs `npm run dev`) |
| `node scripts/create-admin.mjs`    | Create/update an admin user (bootstrap or recovery)        |

The Playwright suite (`npm run test:e2e`) is hermetic by default. The
`e2e/responsive.spec.ts` spec additionally checks the signed-in app for
horizontal overflow and console errors at 1440/1280/768/390 px; it self-skips
unless `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` are set:

```bash
E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… npm run test:e2e
```

## Project structure

```
src/
  app/                 Next.js App Router (layout, pages, route handlers)
  components/
    layout/            Page structure (Container, shell pieces)
    ui/                Design-system primitives (Button, DisplayTitle, Eyebrow)
  design/
    tokens.css         Design tokens + Tailwind theme mapping
  fonts/               Self-hosted DM Sans / Manrope woff2
  lib/                 Framework-agnostic helpers
  test/                Vitest setup
e2e/                   Playwright specs
docs/                  Requirements & design references (see below)
```

## Documentation

- `docs/AUTHENTICATION_AUTHORIZATION.md` — binding auth/authz specification
  (roles, permission keys, sessions, audit, tests).
- `docs/DESIGN_SYSTEM.md` — source visual-language document. See the adaptation
  note at the top of `src/design/tokens.css` for how it is applied to an
  application rather than a marketing site.
- `docs/ARCHITECTURE.md` — system decisions, data model and delivery phases.
- `docs/FLEET_DOMAIN_GAP_ANALYSIS.md` — **historical** (superseded) spec↔
  implementation gap analysis from Phase 4. Kept for provenance; see the
  reconciliation section at its foot and `docs/FLEET_DOMAIN_MODEL.md` for the
  current state.
- `docs/UI_UX_AND_RELEASE_AUDIT.md` — UI/UX and release audit (with a
  remediation addendum) covering route inventory, cross-cutting defects, and
  the production release checklist.
- `docs/FLEET_DOMAIN_MODEL.md` — source-of-truth entities, ledger rules and
  state transitions.
- `docs/FLEET_WORKFLOWS.md` — end-to-end operational workflows (defect→repair→
  release, ledger, inspections, fuel, documents, notifications, cron) and the
  mandated scenario walkthroughs.

## Delivery phases

| Phase | Scope                                             | Status  |
| ----- | ------------------------------------------------- | ------- |
| 0     | Scaffold, design tokens, tooling, CI              | Done    |
| 1     | Auth core (invites, sessions, sign-in/out)        | Done    |
| 2     | RBAC, permission guards, audit logging            | Done    |
| 3     | Fleet domain (vehicles, reports, work orders)     | Done    |
| 4     | Dashboard & app shell                             | Done    |
| A     | Odometer ledger + preventive maintenance engine   | Done    |
| B     | Repair workflow (pipeline + completion evidence)  | Done    |
| C     | Issue↔work-order ecosystem (report→release)       | Done    |
| D     | Assignments, trip distance, inspections           | Done    |
| E–F   | Fuel, documents, notifications + Cron reminders   | Done    |
| 5     | Scheduled maintenance reminders (Vercel Cron)     | Done    |
| G     | Incidents (restricted reports + review)           | Done    |
| G     | Hardened indexes, responsive pass                 | Open    |
| 6     | Hardening (CSP, rate limiting, observability)     | Pending |
