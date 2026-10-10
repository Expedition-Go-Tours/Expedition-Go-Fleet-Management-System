import { describe, expect, it } from "vitest";

import { ALL_PERMISSIONS, PERMISSIONS, rolesHavePermission } from "@/lib/auth/permissions";
import { ROLE_KEYS } from "@/lib/auth/types";
import {
  TOURS,
  availableTours,
  getTour,
  isTourCurrent,
  isTourId,
  normalizeRoute,
  recommendedTour,
  routeSegments,
  shouldShowWelcome,
  tourStatusLabel,
  toursForRoles,
  visibleSteps,
} from "@/lib/onboarding/tours";
import {
  applyOnboardingUpdate,
  emptyOnboardingState,
  parseOnboardingUpdate,
  readOnboardingState,
} from "@/lib/onboarding/state";
import { TOUR_IDS, TOUR_STATUSES, type OnboardingState } from "@/lib/onboarding/types";
import { tourSelector } from "@/components/onboarding/tourEngine";

describe("tour catalogue", () => {
  it("declares every tour id exactly once", () => {
    expect(TOURS.map((tour) => tour.id).sort()).toEqual([...TOUR_IDS].sort());
    expect(new Set(TOURS.map((tour) => tour.id)).size).toBe(TOURS.length);
  });

  it("gives every tour a version, a start route and at least three steps", () => {
    for (const tour of TOURS) {
      expect(tour.version).toBeGreaterThan(0);
      expect(tour.startRoute.startsWith("/")).toBe(true);
      expect(tour.steps.length).toBeGreaterThanOrEqual(3);
      expect(tour.roles.length).toBeGreaterThan(0);
      expect(tour.requiresAnyOf.length).toBeGreaterThan(0);
    }
  });

  it("targets stable data-tour hooks on real routes", () => {
    for (const tour of TOURS) {
      const seen = new Set<string>();
      for (const step of tour.steps) {
        expect(step.target).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(seen.has(`${step.target}@${step.route}`)).toBe(false);
        seen.add(`${step.target}@${step.route}`);
        expect(normalizeRoute(step.route).startsWith("/")).toBe(true);
        expect(step.title.length).toBeGreaterThan(0);
        expect(step.description.length).toBeGreaterThan(20);
        expect(step.description.length).toBeLessThan(320);
      }
    }
  });

  it("only requires permissions that exist in the catalog", () => {
    for (const tour of TOURS) {
      for (const key of tour.requiresAnyOf) expect(ALL_PERMISSIONS).toContain(key);
      for (const step of tour.steps) {
        for (const key of step.requires ?? []) expect(ALL_PERMISSIONS).toContain(key);
      }
    }
  });

  it("resolves tours by id and rejects unknown ids", () => {
    expect(getTour("driver")?.id).toBe("driver");
    expect(getTour("nope")).toBeNull();
    expect(getTour(undefined)).toBeNull();
    expect(isTourId("maintenance")).toBe(true);
    expect(isTourId("payroll")).toBe(false);
  });
});

describe("role → tour selection", () => {
  it("maps every role to exactly one tour", () => {
    for (const role of ROLE_KEYS) {
      expect(toursForRoles([role])).toHaveLength(1);
    }
    expect(new Set(ROLE_KEYS.map((role) => toursForRoles([role])[0]?.id))).toEqual(
      new Set(TOUR_IDS),
    );
  });

  it("shows a driver the driver tour, not the maintenance or admin tour", () => {
    const ids = availableTours(["DRIVER"], [...permissionsOf("DRIVER")]).map((t) => t.id);
    expect(ids).toEqual(["driver"]);
    expect(ids).not.toContain("maintenance");
    expect(ids).not.toContain("admin");
    expect(ids).not.toContain("finance");
  });

  it("shows finance and admin users only their own tour", () => {
    expect(availableTours(["FINANCE"], [...permissionsOf("FINANCE")]).map((t) => t.id)).toEqual([
      "finance",
    ]);
    expect(availableTours(["ADMIN"], [...permissionsOf("ADMIN")]).map((t) => t.id)).toEqual([
      "admin",
    ]);
    expect(availableTours(["MANAGER"], [...permissionsOf("MANAGER")]).map((t) => t.id)).toEqual([
      "admin",
    ]);
    expect(
      availableTours(["OPERATIONS"], [...permissionsOf("OPERATIONS")]).map((t) => t.id),
    ).toEqual(["operations"]);
    expect(
      availableTours(["MAINTENANCE"], [...permissionsOf("MAINTENANCE")]).map((t) => t.id),
    ).toEqual(["maintenance"]);
  });

  it("orders multi-role users most privileged first", () => {
    const permissions = [...permissionsOf("DRIVER"), ...permissionsOf("FINANCE")];
    expect(availableTours(["DRIVER", "FINANCE"], permissions).map((t) => t.id)).toEqual([
      "finance",
      "driver",
    ]);
  });

  it("offers nothing when the backing permission is missing", () => {
    expect(availableTours(["DRIVER"], [])).toEqual([]);
    expect(recommendedTour(["DRIVER"], [])).toBeNull();
    expect(recommendedTour(["DRIVER"], [...permissionsOf("DRIVER")])?.id).toBe("driver");
  });

  it("hides steps whose permission the role does not hold", () => {
    const admin = getTour("admin")!;
    const managerPermissions = [...permissionsOf("MANAGER")];
    expect(managerPermissions).not.toContain(PERMISSIONS.USER_ROLE_ASSIGN);

    const managerSteps = visibleSteps(admin, managerPermissions);
    expect(managerSteps).toHaveLength(admin.steps.length);
    expect(
      managerSteps.every(
        (step) => !step.requires || step.requires.some((key) => managerPermissions.includes(key)),
      ),
    ).toBe(true);

    // A step guarded by an extra permission is dropped rather than shown to
    // someone who does not hold it.
    const restricted = {
      ...admin,
      steps: [
        ...admin.steps,
        {
          route: "/",
          target: "ghost-control",
          title: "Ghost",
          description: "Only visible to a permission that does not exist here.",
          requires: [PERMISSIONS.SETTINGS_UPDATE],
        },
      ],
    };
    const permitted = [PERMISSIONS.USER_READ, PERMISSIONS.AUDIT_READ, PERMISSIONS.VEHICLE_READ];
    const kept = visibleSteps(restricted, permitted);
    expect(kept).toHaveLength(admin.steps.length);
    expect(kept.some((step) => step.target === "ghost-control")).toBe(false);
  });

  it("gates the admin tour on the same permission the page enforces", () => {
    const permissions = [...permissionsOf("MANAGER")];
    expect(permissions).toContain(PERMISSIONS.USER_READ);
    expect(rolesHavePermission(["MANAGER"], PERMISSIONS.USER_READ)).toBe(true);
    expect(rolesHavePermission(["MANAGER"], PERMISSIONS.USER_UPDATE)).toBe(false);
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.USER_UPDATE)).toBe(true);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.USER_UPDATE)).toBe(false);
  });
});

describe("welcome and completion state", () => {
  const driver = getTour("driver")!;

  it("shows the welcome experience to a brand-new employee", () => {
    expect(shouldShowWelcome({}, driver)).toBe(true);
    expect(shouldShowWelcome(emptyOnboardingState("u1").tours, driver)).toBe(true);
  });

  it("does not re-trigger after a dismissal on ordinary navigation", () => {
    const state = applyOnboardingUpdate(emptyOnboardingState("u1"), {
      kind: "tour",
      tourId: "driver",
      status: "DISMISSED",
      version: driver.version,
    });
    expect(shouldShowWelcome(state.tours, driver)).toBe(false);
    expect(shouldShowWelcome(state.tours, driver)).toBe(false);
    expect(tourStatusLabel(state.tours, driver)).toBe("Seen");
  });

  it("does not re-trigger after completion", () => {
    const state = applyOnboardingUpdate(emptyOnboardingState("u1"), {
      kind: "tour",
      tourId: "driver",
      status: "COMPLETED",
      version: driver.version,
    });
    expect(shouldShowWelcome(state.tours, driver)).toBe(false);
    expect(tourStatusLabel(state.tours, driver)).toBe("Completed");
  });

  it("re-offers the tour when its version is bumped", () => {
    const stored = {
      driver: {
        status: "COMPLETED" as const,
        version: driver.version,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    expect(shouldShowWelcome(stored, driver)).toBe(false);
    expect(isTourCurrent(stored.driver, driver)).toBe(true);

    const redesigned = { ...driver, version: driver.version + 1 };
    expect(shouldShowWelcome(stored, redesigned)).toBe(true);
    expect(isTourCurrent(stored.driver, redesigned)).toBe(false);
    expect(tourStatusLabel(stored, redesigned)).toBe("Not started");
  });

  it("keeps a completion result distinct from a dismissal", () => {
    const state = applyOnboardingUpdate(emptyOnboardingState("u1"), {
      kind: "tour",
      tourId: "driver",
      status: "COMPLETED",
      version: driver.version,
    });
    expect(state.tours.driver?.status).toBe("COMPLETED");
    const dismissed = applyOnboardingUpdate(state, {
      kind: "tour",
      tourId: "driver",
      status: "DISMISSED",
      version: driver.version,
    });
    expect(dismissed.tours.driver?.status).toBe("DISMISSED");
    expect(dismissed.tours.driver?.updatedAt).toBeTruthy();
  });
});

describe("onboarding update validation (server-authoritative)", () => {
  const driver = getTour("driver")!;

  it("accepts a well-formed payload", () => {
    const result = parseOnboardingUpdate({
      tourId: "driver",
      status: "COMPLETED",
      version: driver.version,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tourId).toBe("driver");
  });

  it("rejects an unknown tour id", () => {
    const result = parseOnboardingUpdate({ tourId: "payroll", status: "COMPLETED", version: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("tourId");
  });

  it("rejects an unknown status", () => {
    const result = parseOnboardingUpdate({ tourId: "driver", status: "SKIPPED", version: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("status");
  });

  it("rejects a version the server does not publish", () => {
    const result = parseOnboardingUpdate({
      tourId: "driver",
      status: "COMPLETED",
      version: driver.version + 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("version mismatch");
  });

  it("rejects malformed versions and bodies", () => {
    expect(parseOnboardingUpdate(null).ok).toBe(false);
    expect(parseOnboardingUpdate("driver").ok).toBe(false);
    expect(parseOnboardingUpdate({ tourId: "driver", status: "COMPLETED" }).ok).toBe(false);
    expect(parseOnboardingUpdate({ tourId: "driver", status: "COMPLETED", version: 1.5 }).ok).toBe(
      false,
    );
    expect(parseOnboardingUpdate({ tourId: "driver", status: "COMPLETED", version: 0 }).ok).toBe(
      false,
    );
    expect(
      parseOnboardingUpdate({ tourId: "driver", status: "COMPLETED", version: 100_000 }).ok,
    ).toBe(false);
  });

  it("accepts every status in the published catalogue", () => {
    for (const status of TOUR_STATUSES) {
      expect(parseOnboardingUpdate({ tourId: "driver", status, version: driver.version }).ok).toBe(
        true,
      );
    }
  });
});

describe("reading persisted state", () => {
  it("starts empty for a new user", () => {
    const state = emptyOnboardingState("u1");
    expect(state.userId).toBe("u1");
    expect(state.tours).toEqual({});
  });

  it("keeps valid entries and drops malformed ones", () => {
    const state = readOnboardingState("u1", {
      tours: {
        driver: {
          status: "COMPLETED",
          version: 1,
          updatedAt: { toDate: () => new Date("2026-02-03T04:05:06.000Z") },
        },
        finance: { status: "NOT_A_STATUS", version: 1, updatedAt: "2026-02-03T04:05:06.000Z" },
        operations: { status: "DISMISSED", version: 0, updatedAt: "2026-02-03T04:05:06.000Z" },
        maintenance: { status: "DISMISSED", version: 2, updatedAt: "not-a-date" },
        unknown: { status: "DISMISSED", version: 2, updatedAt: "2026-02-03T04:05:06.000Z" },
      },
    });

    expect(Object.keys(state.tours)).toEqual(["driver"]);
    expect(state.tours.driver).toEqual({
      status: "COMPLETED",
      version: 1,
      updatedAt: "2026-02-03T04:05:06.000Z",
    });
  });

  it("survives a completely invalid document", () => {
    expect(readOnboardingState("u1", null).tours).toEqual({});
    expect(readOnboardingState("u1", "nope").tours).toEqual({});
    expect(readOnboardingState("u1", { tours: 42 }).tours).toEqual({});
  });

  it("serializes to a plain, RSC-safe object", () => {
    const state = applyOnboardingUpdate(
      emptyOnboardingState("u1"),
      { kind: "tour", tourId: "driver", status: "COMPLETED", version: 1 },
      new Date("2026-03-04T05:06:07.000Z"),
    );
    const serialized = JSON.parse(JSON.stringify(state)) as OnboardingState;
    expect(serialized).toEqual(state);
    expect(serialized.tours.driver?.updatedAt).toBe("2026-03-04T05:06:07.000Z");
  });
});

describe("route helpers", () => {
  it("normalises trailing slashes and strips query/hash", () => {
    expect(normalizeRoute("/vehicles")).toBe("/vehicles");
    expect(normalizeRoute("/vehicles/")).toBe("/vehicles");
    expect(normalizeRoute("/vehicles?page=2")).toBe("/vehicles");
    expect(normalizeRoute("/vehicles#top")).toBe("/vehicles");
    expect(normalizeRoute("/")).toBe("/");
    expect(normalizeRoute("")).toBe("/");
  });

  it("groups contiguous steps by route", () => {
    const tour = getTour("operations")!;
    const segments = routeSegments(tour.steps);
    expect(segments.length).toBeGreaterThanOrEqual(3);
    expect(segments[0]).toBe("/");
    expect(new Set(segments).size).toBe(segments.length);
  });
});

describe("tour target selectors", () => {
  it("builds a data-tour attribute selector", () => {
    expect(tourSelector("dashboard-overview")).toBe('[data-tour="dashboard-overview"]');
  });

  it("never lets a target break out of the selector", () => {
    expect(tourSelector('x"] , body *')).toBe('[data-tour="xbody"]');
    expect(tourSelector("")).toBe('[data-tour=""]');
  });
});

/** Effective permissions for a role, straight from the role matrix. */
function permissionsOf(role: (typeof ROLE_KEYS)[number]): Set<string> {
  const result = new Set<string>();
  for (const permission of ALL_PERMISSIONS) {
    if (rolesHavePermission([role], permission)) result.add(permission);
  }
  return result;
}
