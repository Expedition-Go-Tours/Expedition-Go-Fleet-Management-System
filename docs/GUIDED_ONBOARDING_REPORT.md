# Guided Onboarding Tours — Implementation Report

> **Application:** Expedition Go Tours Fleet Management System
> **Date:** 2026-10-10
> **Commit:** `92e259a` on `main`

---

## 1. What was built

### Guided onboarding system

Five role-specific interactive tours powered by **Driver.js v1.9.0**, styled with
the Expedition Go Tours design tokens:

| Tour | Role(s) | Steps | Routes covered |
|---|---|---|---|
| Driver | DRIVER | 6 | `/workspace` |
| Operations | OPERATIONS | 5 | `/`, `/vehicles`, `/reports` |
| Maintenance | MAINTENANCE | 6 | `/`, `/maintenance`, `/work-orders`, `/vehicles` |
| Finance | FINANCE | 5 | `/expenses`, `/fuel`, `/work-orders` |
| Admin & manager | ADMIN, MANAGER | 6 | `/`, `/vehicles`, `/users`, `/audit` |

### Welcome experience

A modal shown once per tour version to each authenticated employee on their first
visit. Includes the employee's role, a summary of what the tour covers, and two
clear actions ("Start guided tour" / "Maybe later"). Dismissing it never blocks
the app, and the Help menu keeps every tour permanently replayable.

### Admin user management

A filterable employee directory with role/status/search controls. Administrators
can edit a driver's name and phone directly from the list, with every change
logged to the audit trail (`user.updated`). Roles and status retain their
existing dedicated endpoints and invariants.

### `data-tour` hooks

Stable `data-tour="target-slug"` attributes placed on 30+ real controls across
the entire application: dashboard hero, KPI sections, priority queue, every
sidebar nav link, the mobile menu button, search, notifications, the help menu,
every page header, key cards, list rows, filter controls, and the invite form.

---

## 2. Acceptance criteria — status

| # | Criterion | Result |
|---|---|---|
| 1 | A newly created driver receives the driver welcome experience | **PASS** — verified live with Kofi (DRIVER role) |
| 2 | The driver tour highlights the actual driver workspace and reporting controls | **PASS** — all 6 steps highlighted real targets with correct copy |
| 3 | A maintenance user receives the appropriate maintenance tour, not the driver tour | **PASS** — verified live with `QA Maintenance` (MAINTENANCE only) |
| 4 | Finance and admin users see only the appropriate tours | **PASS** — verified live for both FINANCE and ADMIN; Help menu shows only the matching tour |
| 5 | Dismissing the welcome does not repeatedly trigger it on ordinary navigation | **PASS** — confirmed: after skip/complete, navigating between pages never re-shows the modal |
| 6 | A completed tour is recorded against the authenticated user | **PASS** — `GET /api/v1/onboarding` returns `{ status: "COMPLETED", version, updatedAt }` per tour |
| 7 | A user can replay the tour from Help | **PASS** — Help menu lists the tour with "Replay" semantics; restarts from step 1 |
| 8 | A tour-version change can make an updated tour available | **PASS** — verified live: bumping `admin.version` to 2 re-offered the welcome modal to the same user |
| 9 | A target missing because of role restrictions or responsive layout does not break the tour | **PASS** — sidebar link invisible on mobile gracefully falls back to the hamburger menu button; hidden targets are skipped after timeout |
| 10 | Cross-route tours wait for page rendering before continuing | **PASS** — all multi-route tours navigated via `router.push` and resumed only after the target element rendered |
| 11 | Reloading or leaving a tour has predictable and safe behavior | **PASS** — Escape exits cleanly (popover removed, `driver-active` class cleaned up); on unmount the controller tears down |
| 12 | Tours do not submit forms or mutate business records | **PASS** — `disableActiveInteraction: true` and `overlayClickBehavior: "none"` prevent all pointer interaction on the page |
| 13 | Mobile and desktop tooltips are positioned correctly | **PASS** — verified at 390×844, 360×800, 768×1024, 1280×800, 1440×900; zero horizontal overflow at every viewport |
| 14 | Keyboard navigation and focus behavior work | **PASS** — Tab reaches popover controls; Escape exits; driver's `allowKeyboardControl` handles arrows |
| 15 | Existing authentication, session, permissions and business workflows continue to work | **PASS** — typecheck, lint, 175 unit tests, production build all pass |

---

## 3. How it works

### Data flow

1. **Server** (`AppShell`) loads the employee's onboarding state from Firestore
   and passes it as an RSC prop to `OnboardingProvider`.
2. **Provider** decides whether to show the welcome modal (no current completion
   for the recommended tour), manages active-tour state and completion toast,
   and POSTs updates to `POST /api/v1/onboarding`.
3. **TourRunner** holds a `TourController` (the Driver.js bridge). It manages
   the route-aware lifecycle: if a step lives on a different route the controller
   parks, navigates via `router.push`, and resumes when the target appears.
4. **Driver.js** owns the spotlight, the popover and keyboard handling.
   All visual styling uses the `.egt-tour` CSS class (global stylesheet).

### Persistence

One Firestore document per authenticated user in the `onboarding` collection,
keyed by user id. Writes run inside a transaction so concurrent tabs cannot lose
each other's result. The document contains:

```json
{
  "schemaVersion": 1,
  "tours": {
    "driver":  { "status": "COMPLETED", "version": 1, "updatedAt": "2026-10-10T22:18:26.159Z" }
  }
}
```

The version is validated against the server's canonical tour definition — a
stale or hand-rolled client cannot write progress for a version that does not
exist.

### Permissions

Onboarding is self-scoped by construction: the document id is the session
user's own id, and there is no target-id field in the body. No additional
permission key is required beyond a valid, active session. The `mustChangePassword`
guard blocks onboarding reads/writes during the invite-acceptance flow.

---

## 4. New and modified files

### New files

| File | Purpose |
|---|---|
| `src/lib/onboarding/types.ts` | Domain types (TourId, TourStep, TourDefinition, OnboardingState, TourEndReason) |
| `src/lib/onboarding/tours.ts` | Tour definitions, role→tour mapping, step filtering, welcome/version helpers |
| `src/lib/onboarding/state.ts` | Validation, serialization, parse, apply, read from Firestore |
| `src/lib/onboarding/onboarding.test.ts` | 31 unit tests |
| `src/lib/repos/onboarding.ts` | Firestore repo (transactional read/write) |
| `src/app/api/v1/onboarding/route.ts` | GET + POST API route |
| `src/components/onboarding/context.ts` | React context + `useOnboarding` hook |
| `src/components/onboarding/OnboardingProvider.tsx` | Shell-level provider |
| `src/components/onboarding/WelcomeModal.tsx` | First-run welcome experience |
| `src/components/onboarding/HelpMenu.tsx` | Header help menu with tour replay |
| `src/components/onboarding/TourRunner.tsx` | Driver.js bridge component |
| `src/components/onboarding/tourEngine.ts` | Route-aware tour controller |
| `src/components/onboarding/CompletionToast.tsx` | "Tour complete" confirmation |
| `src/components/admin/UserDirectory.tsx` | Filterable employee directory |
| `src/components/admin/EditUserDialog.tsx` | Admin edit profile dialog |
| `src/app/api/v1/users/[id]/route.ts` | PATCH user profile (name/phone) |
| `scripts/lib/e2e-cleanup.mjs` | Shared E2E teardown helper |
| `e2e/onboarding.spec.ts` | Self-skipping Playwright spec |
| `docs/screenshots/*.png` | Visual evidence (6 screenshots) |

### Modified files

| File | Change |
|---|---|
| `src/lib/auth/permissions.ts` | Added `USER_UPDATE` |
| `src/lib/db/collections.ts` | Added `onboarding` collection |
| `src/lib/repos/audit.ts` | Added `USER_UPDATED` audit event |
| `src/lib/repos/users.ts` | Added `updateUserProfile` |
| `src/components/ui/Card.tsx` | Added `dataTour` prop |
| `src/components/ui/PageHeader.tsx` | Added `dataTour` prop |
| `src/components/layout/AppShell.tsx` | Wraps shell with OnboardingProvider |
| `src/components/layout/ShellLayout.tsx` | Renders HelpMenu; nav links get `data-tour` |
| `src/components/layout/nav.ts` | Added `navTourId()` helper |
| `src/components/notifications/NotificationBell.tsx` | `data-tour="header-notifications"` |
| `src/components/search/GlobalSearch.tsx` | `data-tour="header-search"` |
| `src/app/globals.css` | `.driver-popover.egt-tour` overrides (60+ rules) |
| `src/app/(app)/page.tsx` | Dashboard tour targets |
| `src/app/(app)/workspace/page.tsx` | Workspace tour targets; inspections always visible |
| `src/app/(app)/vehicles/page.tsx` | Vehicle list tour targets |
| `src/app/(app)/reports/page.tsx` | Reports board tour targets |
| `src/app/(app)/work-orders/page.tsx` | Work orders board tour targets |
| `src/app/(app)/maintenance/page.tsx` | Maintenance board tour targets |
| `src/app/(app)/expenses/page.tsx` | Expenses ledger tour targets |
| `src/app/(app)/fuel/page.tsx` | Fuel ledger tour targets |
| `src/app/(app)/audit/page.tsx` | Audit log tour target |
| `src/app/(app)/users/page.tsx` | User directory with filters |
| `scripts/e2e-fleet.mjs`, `e2e-operations.mjs`, `e2e-concurrency.mjs` | Wire shared e2e cleanup |
| `package.json` | Added `driver.js` dependency |

---

## 5. Evidence

### Screenshots

- `docs/screenshots/onboarding-welcome-desktop.png` — Welcome modal at 1440×900
- `docs/screenshots/onboarding-tour-step1-desktop.png` — Driver tour step 1/6
- `docs/screenshots/onboarding-tour-step2-desktop.png` — Driver tour step 2/6
- `docs/screenshots/onboarding-help-menu.png` — Help menu with tour status
- `docs/screenshots/onboarding-tour-mobile-390.png` — Tour popover at 390×844
- `docs/screenshots/admin-user-directory.png` — Employee directory with filters

### Test results

- **Typecheck:** 0 errors
- **Lint (eslint):** 0 errors, 0 warnings
- **Prettier:** all files pass
- **Unit tests:** 175 passed (16 test files), including 31 new onboarding tests
- **Production build:** successful

### Live browser verification

All five tours were run end-to-end via Playwright against the live dev server:

| Tour | Steps | Routes | All targets highlighted | Overflow | Persisted |
|---|---|---|---|---|---|
| Driver | 6/6 | `/workspace` | ✓ | 0 | ✓ |
| Operations | 5/5 | `/ → /vehicles → /reports` | ✓ | 0 | ✓ |
| Maintenance | 6/6 | `/ → /maintenance → /work-orders → /vehicles` | ✓ | 0 | ✓ |
| Finance | 5/5 | `/expenses → /fuel → /work-orders` | ✓ | 0 | ✓ |
| Admin | 6/6 | `/ → /vehicles → /users → /audit → /` | ✓ | 0 | ✓ |

Additional verified behaviors:

- Missing target → skipped after timeout (step 2 hidden, jumped to step 3)
- Mobile 390/360: `nav-work-orders` invisible → fallback `nav-mobile-menu` used
- Keyboard: Tab focuses popover, Escape exits cleanly
- Version bump → welcome re-offered (acceptance #8)
- Help menu shows only the matching tour per role
- No console errors from the onboarding system itself

---

## 6. Known limitations and `NOT VERIFIED`

| Item | Status | Reason |
|---|---|---|
| Operations tour step "Assign a driver" | Simplified | Folded into the vehicle-list step description; no standalone "Assign" control is reliably targetable without a specific vehicle |
| Finance tour expense filters | Honored as-is | The app does not yet have expense date/vehicle filters; the tour copy directs users to global search (⌘K) and CSV export |
| Tour runs inside a Playwright iframe | NOT VERIFIED | Only tested in the main browser context |
| MFA interaction | NOT VERIFIED | `REQUIRE_MFA=false` in development; no TOTP flow exists yet |

---

## 7. Architecture decisions

- **Driver.js v1.9.0** chosen: MIT-licensed, framework-agnostic, actively maintained, supports
  `onNextClick`/`onCloseClick` overrides, cross-route navigation via a custom controller.
- **CSS import** (`driver.js/dist/driver.css`) loaded in `TourRunner.tsx`; all visual overrides
  use `.driver-popover.egt-tour` specificity over Driver's defaults and reference the existing
  design tokens.
- **No SSR hazard**: `driver.js` is imported dynamically inside the controller; the `TourRunner`
  component renders `null` (no markup); the `OnboardingProvider` is a client component that
  initializes `welcomeOpen` in a `useState` initializer to avoid hydration mismatches.
- **Self-scoped persistence**: the onboarding document id is always the session user's id, and
  the API has no target-id parameter. One employee can never read or write another's record.
- **Version validation**: the POST route validates the version against the server's own tour
    definition, so a stale or hand-rolled client cannot write progress for a nonexistent version.
- **Graceful degradation**: every tour step declares a target and optional fallbacks. Missing or
  hidden targets (responsive layout, conditional rendering, role restriction) are polled for up to
  8 seconds then skipped. A stalled route change (15 s) exits the tour cleanly.