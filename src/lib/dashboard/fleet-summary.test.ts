import { describe, expect, it } from "vitest";

import {
  OPEN_ISSUE_STATUSES,
  OPEN_WORK_ORDER_STATUSES,
  parseAvailabilityFilter,
  summariseFleet,
  vehicleMatchesAvailability,
  WORK_ORDER_OPEN_STATUS_SET,
} from "@/lib/dashboard/fleet-summary";

function vehicle(id: string, status: string) {
  return { id, status };
}

describe("fleet availability — KPI and drill-down agree", () => {
  const fleet = [
    vehicle("v-free", "ACTIVE"), // available
    vehicle("v-assigned", "ACTIVE"), // in use
    vehicle("v-critical", "ACTIVE"), // blocked by an open safety-critical issue
    vehicle("v-workshop", "IN_SERVICE"),
    vehicle("v-hold", "SAFETY_HOLD"),
    vehicle("v-archived", "ARCHIVED"),
  ];

  const activeAssignments = new Set(["v-assigned"]);
  const criticalIssues = new Set(["v-critical"]);

  it("summariseFleet splits the fleet by the documented rules", () => {
    const summary = summariseFleet(fleet, activeAssignments, criticalIssues);
    expect(summary.total).toBe(6);
    expect(summary.inUse).toBe(1); // v-assigned
    expect(summary.inWorkshop).toBe(1); // v-workshop
    expect(summary.safetyHolds).toBe(1); // v-hold
    // available = ACTIVE and not assigned and no critical issue → only v-free
    expect(summary.available).toBe(1);
  });

  it("the 'available' count equals the number of rows the drill-down returns", () => {
    const summary = summariseFleet(fleet, activeAssignments, criticalIssues);
    const matches = fleet.filter((v) =>
      vehicleMatchesAvailability(v, "available", activeAssignments, criticalIssues),
    );
    expect(matches.map((v) => v.id)).toEqual(["v-free"]);
    expect(matches.length).toBe(summary.available);
  });

  it("the 'in use' count equals the drill-down result", () => {
    const summary = summariseFleet(fleet, activeAssignments, criticalIssues);
    const matches = fleet.filter((v) =>
      vehicleMatchesAvailability(v, "in_use", activeAssignments, criticalIssues),
    );
    expect(matches.map((v) => v.id)).toEqual(["v-assigned"]);
    expect(matches.length).toBe(summary.inUse);
  });

  it("availability is stricter than status ACTIVE", () => {
    // An assigned or critically-faulted ACTIVE vehicle is NOT available.
    expect(
      vehicleMatchesAvailability(
        vehicle("v-assigned", "ACTIVE"),
        "available",
        activeAssignments,
        criticalIssues,
      ),
    ).toBe(false);
    expect(
      vehicleMatchesAvailability(
        vehicle("v-critical", "ACTIVE"),
        "available",
        activeAssignments,
        criticalIssues,
      ),
    ).toBe(false);
    // Non-ACTIVE is never available even with no blockers.
    expect(
      vehicleMatchesAvailability(
        vehicle("x", "SAFETY_HOLD"),
        "available",
        activeAssignments,
        criticalIssues,
      ),
    ).toBe(false);
    expect(
      vehicleMatchesAvailability(
        vehicle("x", "IN_SERVICE"),
        "available",
        activeAssignments,
        criticalIssues,
      ),
    ).toBe(false);
  });

  it("a vehicle with no assignments or issues is available", () => {
    expect(
      vehicleMatchesAvailability(vehicle("ok", "ACTIVE"), "available", new Set(), new Set()),
    ).toBe(true);
  });

  it("parseAvailabilityFilter accepts only the two known values", () => {
    expect(parseAvailabilityFilter("available")).toBe("available");
    expect(parseAvailabilityFilter("in_use")).toBe("in_use");
    expect(parseAvailabilityFilter(undefined)).toBeNull();
    expect(parseAvailabilityFilter("ACTIVE")).toBeNull();
    expect(parseAvailabilityFilter("")).toBeNull();
  });

  it("open-status sets are internally consistent", () => {
    expect(WORK_ORDER_OPEN_STATUS_SET.size).toBe(OPEN_WORK_ORDER_STATUSES.length);
    for (const status of OPEN_WORK_ORDER_STATUSES) {
      expect(WORK_ORDER_OPEN_STATUS_SET.has(status)).toBe(true);
    }
    // CLOSED is never an open issue state.
    expect((OPEN_ISSUE_STATUSES as readonly string[]).includes("CLOSED")).toBe(false);
  });
});
