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

## Delivery phases

| Phase | Scope                                          | Status  |
| ----- | ---------------------------------------------- | ------- |
| 0     | Scaffold, design tokens, tooling, CI           | Done    |
| 1     | Auth core (invites, sessions, sign-in/out)     | Done    |
| 2     | RBAC, permission guards, audit logging         | Done    |
| 3     | Fleet domain (vehicles, work orders, expenses) | Pending |
| 4     | Dashboard & app shell                          | Pending |
| 5     | Scheduled maintenance reminders (Vercel Cron)  | Pending |
| 6     | Hardening (CSP, rate limiting, observability)  | Pending |
