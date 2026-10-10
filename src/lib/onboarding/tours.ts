import { PERMISSIONS } from "@/lib/auth/permissions";
import type { RoleKey } from "@/lib/auth/types";
import type { TourDefinition, TourId, TourProgress, TourStep } from "@/lib/onboarding/types";

/*
 * Role-specific guided tours.
 *
 * Tours are authored against the *real* permission system: each tour declares
 * the roles it is written for and the permission that must hold before it is
 * offered, and each step can carry its own `requires` so a user is never shown
 * a control their role cannot use. Selection is derived from the same role
 * matrix the server enforces on every request.
 */

/**
 * Role precedence for users holding several roles. The most privileged tour
 * the user qualifies for is the default; every qualifying tour stays replayable
 * from Help.
 */
export const ROLE_TOUR_ORDER: readonly RoleKey[] = [
  "ADMIN",
  "MANAGER",
  "OPERATIONS",
  "MAINTENANCE",
  "FINANCE",
  "DRIVER",
];

export const ROLE_TOUR: Record<RoleKey, TourId> = {
  ADMIN: "admin",
  MANAGER: "admin",
  OPERATIONS: "operations",
  MAINTENANCE: "maintenance",
  FINANCE: "finance",
  DRIVER: "driver",
};

export const TOURS: readonly TourDefinition[] = [
  {
    id: "driver",
    version: 1,
    title: "Driver tour",
    summary: "Trips, odometer readings, inspections and reporting from the driver workspace.",
    roles: ["DRIVER"],
    requiresAnyOf: [PERMISSIONS.REPORT_CREATE, PERMISSIONS.ASSIGNMENT_START],
    startRoute: "/workspace",
    steps: [
      {
        route: "/workspace",
        target: "driver-welcome",
        title: "Your driver workspace",
        description:
          "Everything you record here — trips, inspections, problems — becomes part of the official fleet record.",
        side: "bottom",
      },
      {
        route: "/workspace",
        target: "driver-trip",
        title: "Start and end a trip",
        description:
          "Start a trip when operations assigns you a vehicle (or start one yourself), then end it with your actual odometer reading so the mileage ledger stays accurate.",
        side: "top",
      },
      {
        route: "/workspace",
        target: "driver-inspections",
        title: "Pre-trip and return checks",
        description:
          "Run the pre-trip check before you leave and the return check when you're back. A failed critical item raises a linked issue and a safety hold.",
        side: "top",
      },
      {
        route: "/workspace",
        target: "driver-report",
        title: "Report a problem or incident",
        description:
          "Describe the vehicle, the trip context and any evidence you have. Operations and maintenance see it immediately.",
        side: "left",
      },
      {
        route: "/workspace",
        target: "driver-records",
        title: "Follow your reports",
        description:
          "Track everything you've reported and how it is being resolved. Closures and updates land in your records and notifications.",
        side: "top",
      },
      {
        route: "/workspace",
        target: "header-notifications",
        title: "Stay in the loop",
        description:
          "Assignments, replies to your reports and maintenance releases arrive as notifications.",
        side: "bottom",
      },
    ],
  },

  {
    id: "operations",
    version: 1,
    title: "Operations tour",
    summary: "Run the dashboard, assign drivers, check availability and triage driver reports.",
    roles: ["OPERATIONS"],
    requiresAnyOf: [
      PERMISSIONS.ASSIGNMENT_CREATE,
      PERMISSIONS.REPORT_READ_ALL,
      PERMISSIONS.INCIDENT_MANAGE,
    ],
    startRoute: "/",
    steps: [
      {
        route: "/",
        target: "dashboard-overview",
        title: "Operations dashboard",
        description:
          "The control centre shows fleet status derived live from current records — no separate reporting run needed.",
        side: "bottom",
      },
      {
        route: "/",
        target: "dashboard-kpis",
        title: "Today at a glance",
        description:
          "Available, in use, in workshop and safety holds. Every card drills straight into the matching vehicles.",
        side: "top",
      },
      {
        route: "/vehicles",
        target: "vehicle-list",
        title: "Availability and safety restrictions",
        description:
          "Open a vehicle to see its status, open issues and safety holds — a vehicle on hold cannot be assigned. From the profile, choose “Assign driver” to start a trip for an active driver.",
        side: "top",
      },
      {
        route: "/reports",
        target: "reports-board",
        title: "Review and triage reports",
        description:
          "Driver reports land here. Mark them triaged, add detail and track them through to closure.",
        side: "top",
      },
      {
        route: "/reports",
        target: "nav-work-orders",
        fallbacks: ["nav-mobile-menu"],
        title: "From a report to its work order",
        description:
          "Open a report to reach its vehicle and linked work order; jump to Work orders to watch the repair progress.",
        side: "right",
      },
    ],
  },

  {
    id: "maintenance",
    version: 1,
    title: "Maintenance tour",
    summary: "Reminders, open issues, work orders and recording repairs correctly.",
    roles: ["MAINTENANCE"],
    requiresAnyOf: [PERMISSIONS.WORK_ORDER_COMPLETE, PERMISSIONS.SCHEDULE_MANAGE],
    startRoute: "/maintenance",
    steps: [
      {
        route: "/",
        target: "dashboard-maintenance",
        title: "Maintenance health",
        description:
          "Overdue, due and due-soon tasks across the fleet, computed against accepted odometer readings.",
        side: "top",
      },
      {
        route: "/maintenance",
        target: "maintenance-kpis",
        title: "Mileage and time reminders",
        description:
          "Each task is evaluated on both its kilometre and its day interval — the worst of the two wins, so nothing hides behind one metric.",
        side: "bottom",
      },
      {
        route: "/maintenance",
        target: "maintenance-board",
        title: "The preventive maintenance board",
        description:
          "Every configured schedule with last service, next due date and remaining distance or days.",
        side: "top",
      },
      {
        route: "/work-orders",
        target: "work-orders-board",
        title: "Open issues and work orders",
        description:
          "Repairs are tracked as work orders. Create one from an issue, move it through the workflow and keep the reason for any waiting state on the record.",
        side: "top",
      },
      {
        route: "/work-orders",
        target: "work-order-row",
        fallbacks: ["work-orders-board"],
        title: "Record the repair correctly",
        description:
          "Complete a work order with the issues that were actually resolved. That closes the linked issues, updates the vehicle's service history and moves its maintenance schedule forward.",
        side: "top",
      },
      {
        route: "/vehicles",
        target: "nav-vehicles",
        fallbacks: ["nav-mobile-menu"],
        title: "Vehicle history",
        description:
          "Open a vehicle to see its odometer ledger, completed service and documents in one place.",
        side: "right",
      },
    ],
  },

  {
    id: "finance",
    version: 1,
    title: "Finance tour",
    summary: "The expense ledger, recording costs, fuel records and permitted exports.",
    roles: ["FINANCE"],
    requiresAnyOf: [PERMISSIONS.EXPENSE_CREATE, PERMISSIONS.EXPENSE_EXPORT],
    startRoute: "/expenses",
    steps: [
      {
        route: "/expenses",
        target: "expense-ledger",
        title: "The expense ledger",
        description:
          "Every recorded cost with its vehicle, category and status. Recorded is the only state included in totals.",
        side: "top",
      },
      {
        route: "/expenses",
        target: "expense-create",
        title: "Record an expense",
        description:
          "Choose the vehicle, link a work order or service when one applies, and add the supplier and date. Expenses are recorded here — approval happens outside this application.",
        side: "left",
        requires: [PERMISSIONS.EXPENSE_CREATE],
      },
      {
        route: "/expenses",
        target: "expense-export",
        fallbacks: ["expense-header"],
        title: "Find and export records",
        description:
          "Use the headers to read the totals, ⌘K global search to locate a specific record, and export the permitted report as CSV.",
        side: "bottom",
        requires: [PERMISSIONS.EXPENSE_EXPORT],
      },
      {
        route: "/fuel",
        target: "fuel-ledger",
        title: "Fuel records",
        description:
          "Fuel costs are mirrored into the same expense records, and efficiency is only reported from consecutive full-tank fill-ups.",
        side: "top",
        requires: [PERMISSIONS.FUEL_READ],
      },
      {
        route: "/work-orders",
        target: "work-orders-board",
        title: "Work orders and services",
        description:
          "Open a work order to see the repair an expense or service is booked against before you record the cost.",
        side: "top",
        requires: [PERMISSIONS.WORK_ORDER_READ],
      },
    ],
  },

  {
    id: "admin",
    version: 1,
    title: "Admin & manager tour",
    summary: "The fleet dashboard, vehicle history, employee accounts, audit records and reports.",
    roles: ["ADMIN", "MANAGER"],
    requiresAnyOf: [PERMISSIONS.USER_READ, PERMISSIONS.AUDIT_READ, PERMISSIONS.VEHICLE_READ],
    startRoute: "/",
    steps: [
      {
        route: "/",
        target: "dashboard-overview",
        title: "Fleet dashboard",
        description:
          "Status, safety holds and cost in one place, derived live from the records your team maintains.",
        side: "bottom",
      },
      {
        route: "/",
        target: "dashboard-queue",
        title: "Alerts that need a decision",
        description:
          "The priority queue orders critical issues, safety holds, overdue maintenance and expired documents by risk.",
        side: "top",
      },
      {
        route: "/vehicles",
        target: "vehicle-list",
        title: "Vehicle profiles and history",
        description:
          "Each profile carries the odometer ledger, work orders, inspections, documents and service history.",
        side: "top",
      },
      {
        route: "/users",
        target: "admin-users",
        title: "Employee accounts and permissions",
        description:
          "Invite people, review their roles and status, and edit a record directly when you need to correct a driver's details for them.",
        side: "top",
        requires: [PERMISSIONS.USER_READ],
      },
      {
        route: "/audit",
        target: "audit-log",
        title: "Audit records and accountability",
        description:
          "Every sign-in, role change, status change and business action is recorded with the actor and the time.",
        side: "top",
        requires: [PERMISSIONS.AUDIT_READ],
      },
      {
        route: "/",
        target: "nav-work-orders",
        fallbacks: ["nav-mobile-menu"],
        title: "Operational and maintenance reports",
        description:
          "Work orders, Maintenance, Expenses and Fuel in the sidebar are the operational and maintenance reports.",
        side: "right",
      },
    ],
  },
];

const TOUR_BY_ID = new Map<string, TourDefinition>(TOURS.map((tour) => [tour.id, tour]));

export function getTour(id: string | undefined | null): TourDefinition | null {
  if (!id) return null;
  return TOUR_BY_ID.get(id) ?? null;
}

export function isTourId(value: unknown): value is TourId {
  return typeof value === "string" && TOUR_BY_ID.has(value);
}

/** Tours the given roles qualify for, most privileged first. */
export function toursForRoles(roles: readonly RoleKey[]): TourDefinition[] {
  const seen = new Set<TourId>();
  const found: TourDefinition[] = [];
  for (const role of ROLE_TOUR_ORDER) {
    if (!roles.includes(role)) continue;
    const id = ROLE_TOUR[role];
    if (seen.has(id)) continue;
    seen.add(id);
    const tour = TOURS.find((t) => t.id === id);
    if (tour) found.push(tour);
  }
  return found;
}

/** Tours that are actually offered: role-qualified *and* permission-backed. */
export function availableTours(
  roles: readonly RoleKey[],
  permissions: readonly string[],
): TourDefinition[] {
  return toursForRoles(roles).filter((tour) =>
    tour.requiresAnyOf.some((key) => permissions.includes(key)),
  );
}

/** The default tour for a user — the one the welcome experience offers. */
export function recommendedTour(
  roles: readonly RoleKey[],
  permissions: readonly string[],
): TourDefinition | null {
  return availableTours(roles, permissions)[0] ?? null;
}

/** Steps a user may actually see (their role holds the required permission). */
export function visibleSteps(tour: TourDefinition, permissions: readonly string[]): TourStep[] {
  return tour.steps.filter(
    (step) => !step.requires || step.requires.some((key) => permissions.includes(key)),
  );
}

/** True when the stored result already covers the tour's current version. */
export function isTourCurrent(progress: TourProgress | undefined, tour: TourDefinition): boolean {
  return Boolean(progress && progress.version >= tour.version);
}

export function isTourCompleted(progress: TourProgress | undefined, tour: TourDefinition): boolean {
  return progress?.status === "COMPLETED" && isTourCurrent(progress, tour);
}

/**
 * Whether the first-run welcome modal should appear. It is shown once per tour
 * version: dismissing or completing it stops it returning on ordinary
 * navigation, while a version bump re-offers the redesigned tour.
 */
export function shouldShowWelcome(
  tours: Partial<Record<TourId, TourProgress>>,
  tour: TourDefinition,
): boolean {
  return !isTourCurrent(tours[tour.id], tour);
}

/** Status label used in the Help menu. */
export function tourStatusLabel(
  tours: Partial<Record<TourId, TourProgress>>,
  tour: TourDefinition,
): string {
  const progress = tours[tour.id];
  if (!isTourCurrent(progress, tour)) return "Not started";
  return progress?.status === "COMPLETED" ? "Completed" : "Seen";
}

/** Normalise a pathname so `/vehicles/` and `/vehicles` compare equal. */
export function normalizeRoute(route: string): string {
  const trimmed = route.split("?")[0]!.split("#")[0]!;
  if (trimmed.length > 1 && trimmed.endsWith("/")) return trimmed.replace(/\/+$/, "");
  return trimmed || "/";
}

/** Steps grouped into contiguous runs sharing one route (for navigation). */
export function routeSegments(steps: readonly TourStep[]): string[] {
  const routes: string[] = [];
  for (const step of steps) {
    const route = normalizeRoute(step.route);
    if (routes[routes.length - 1] !== route) routes.push(route);
  }
  return routes;
}
