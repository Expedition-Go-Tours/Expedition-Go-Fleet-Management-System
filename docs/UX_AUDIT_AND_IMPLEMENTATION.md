# UX Audit and Implementation Plan

> **Application:** Expedition Go Tours Fleet Management System
> **Date:** 2026-10-10
> **Status:** Implemented — see implementation log below

---

## Current screen inventory

| Route | Purpose | Key issue |
|---|---|---|
| `/` | Fleet control centre (dashboard) | BackButton on homepage is misleading; accent-links not using ButtonLink |
| `/vehicles` | Vehicle list + filters | Raw enum display (`BUS`); no loading skeleton during filter changes |
| `/vehicles/[id]` | Vehicle profile (9 tabs) | `formatMoney` duplicated; `SummaryCell` uses raw string interpolation; `VehicleHero` reimplements breadcrumbs |
| `/reports` | Issues list + create | Uses Eyebrow+DisplayTitle (no breadcrumbs); no pagination (cap 100); no filters component; severity as raw enum |
| `/reports/[id]` | Issue detail | Evidence keys shown as opaque storage keys with no download |
| `/work-orders` | Work orders list | Uses Eyebrow+DisplayTitle (no breadcrumbs); no pagination (cap 500) |
| `/work-orders/[id]` | Work order detail | Timeline uses hardcoded inline styles; `DetailRow` duplicated; priority badge has no tone mapping |
| `/incidents` | Incidents list | No breadcrumbs; no filters; no pagination (cap 100); severity as raw text |
| `/incidents/[id]` | Incident detail | No cross-reference to work orders or issues |
| `/expenses` | Expenses ledger | No breadcrumbs; no filters; no pagination (cap 200); category as raw enum; export uses raw `<a>` tag |
| `/fuel` | Fuel ledger | No date range filter |
| `/maintenance` | Maintenance board | State filter has no UI control (KPI links only) |
| `/notifications` | Notification centre | No type/read-status filter; breadcrumb says "Administration" |
| `/workspace` | Driver workspace | Dead code in ternary (line 190); no link to full incidents list |
| `/users` | User administration | No breadcrumbs; client-side filters not URL-persisted; no pagination |
| `/audit` | Audit log | No breadcrumbs; no filters; no pagination (cap 200); raw Firestore query; inconsistent timestamp format |
| `/sign-in` | Sign-in form | Error messages use `text-accent` (orange) instead of `text-error` (red) |

## Shared component issues

| Component | Issue | Severity |
|---|---|---|
| `CreateForm` | Bypasses `Field`/`Input`/`Select`/`Textarea` design system | P1 |
| `InviteUserForm` | Same bypass as CreateForm | P1 |
| `UserStatusButton` | Uses `window.confirm()` instead of accessible Modal | P0 |
| `DataTable` | Missing `aria-sort` on sorted columns | P3 |
| `Tabs` | No keyboard arrow key navigation | P1 |
| `GlobalSearch` | No focus trap in dialog; uses `window.location.assign` | P1 |
| `NotificationBell` | No focus trap in popover | P1 |
| `ShellLayout` | User menu has no outside-click/Escape close; mobile drawer has no focus trap | P1 |
| `VehicleDetailTabs` | Duplicated `formatMoney`; `DetailRow`/`Row` pattern exists in 4 files | P2 |
| `StatusBadge` | No tone mapping for priorities (NORMAL/HIGH/URGENT) | P3 |

## Cross-reference gaps

- Incident detail → no link to related work orders or issues
- Expense list items → work order title shown as text, not a link
- Audit log entries → entity references not clickable
- Notification bell → `linkUrl="/"` navigates to dashboard (confusing)
- Notifications page → breadcrumb says "Administration > Notifications"

## Accessibility gaps

1. No `aria-sort` on sorted DataTable columns
2. No keyboard arrow navigation in Tabs
3. No focus trap in GlobalSearch, mobile drawer, notification popover
4. User account menu: no Escape or outside-click close
5. `window.confirm()` in UserStatusButton
6. Sign-in errors use brand colour instead of semantic error colour
7. Missing `aria-label` on some icon-only buttons (filter clear)

## Responsive concerns

1. DataTable has no horizontal scroll indicator
2. Vehicle detail tabs may overflow on narrow screens without indication
3. Dashboard KPI grid shows 5 items → last one alone on mobile row
4. Work-order timeline cramped on mobile

## Design system drift

1. `bg-white` hardcoded in CreateForm/InviteUserForm selects (should be `bg-surface`)
2. `text-[10px]` used for micro-text (not in type scale)
3. Styleguide palette values stale vs actual tokens
4. Sign-in error colour wrong (accent vs error)
5. Container component used on some pages but not others → inconsistent gutters
6. `Container` double-nests `max-w-[1440px]` when inside the app layout
7. Two page-header patterns (PageHeader with crumbs vs Eyebrow+DisplayTitle without)

---

## Implementation plan

### Phase A — Shell, design system, shared components
1. Fix ShellLayout: user menu close (outside-click + Escape), mobile drawer focus trap, notification popover focus trap
2. Fix Tabs: keyboard arrow navigation
3. Fix GlobalSearch: focus trap, use router.push
4. Fix DataTable: add aria-sort
5. Fix UserStatusButton: replace window.confirm with Modal
6. Fix CreateForm + InviteUserForm: use Field/Input/Select/Textarea
7. Fix SignInForm: error colour
8. Standardize page headers: add breadcrumbs to all list pages
9. Fix Container: remove double max-width nesting
10. Extract shared DetailRow/StripCell component
11. Add priority tone mapping to StatusBadge
12. Humanize enum display across all pages
13. Fix styleguide palette values

### Phase B — Dashboard and fleet
1. Remove misleading BackButton from dashboard
2. Add loading skeletons to dashboard and vehicle list
3. Improve vehicle list: humanize type enum
4. Improve maintenance: add state filter UI control
5. Fix vehicle detail: extract duplicated formatMoney

### Phase C — Operational records
1. Add filters to incidents page
2. Add pagination where missing (reports, work-orders, expenses, incidents)
3. Fix work order priority badges
4. Fix incident detail: add cross-references
5. Fix report detail: evidence display
6. Fix notifications breadcrumb

### Phase D — Finance and compliance
1. Add filters to expenses page
2. Add date range filter to fuel page
3. Fix expense export button style
4. Fix audit log: add filters, use repository, add entity links, fix timestamp format

### Phase E — Onboarding (complete)
Already implemented in the guided onboarding system.

### Phase F — Accessibility
All items addressed in Phase A.

### Phase G — Regression and verification
Run typecheck, lint, tests, build, browser verification.