import { describe, expect, it } from "vitest";

import { computeTripDistance, defaultVehicleForLogging } from "@/lib/domain/assignment";

describe("trip distance from accepted odometer readings", () => {
  it("is end − start when both readings exist", () => {
    expect(computeTripDistance(80000, 80325)).toEqual({
      distanceKm: 325,
      complete: true,
      conflict: false,
    });
  });

  it("equals zero for a return trip at the same reading", () => {
    expect(computeTripDistance(50000, 50000)).toEqual({
      distanceKm: 0,
      complete: true,
      conflict: false,
    });
  });

  it("is incomplete (not zero) when the start reading is missing", () => {
    expect(computeTripDistance(undefined, 80325)).toEqual({
      distanceKm: null,
      complete: false,
      conflict: false,
    });
    expect(computeTripDistance(null, 80325)).toEqual({
      distanceKm: null,
      complete: false,
      conflict: false,
    });
  });

  it("is incomplete when the end reading is missing", () => {
    expect(computeTripDistance(80000, undefined)).toEqual({
      distanceKm: null,
      complete: false,
      conflict: false,
    });
  });

  it("flags a conflict and fabricates no negative distance when the end is lower", () => {
    const result = computeTripDistance(80325, 80000);
    expect(result).toEqual({ distanceKm: null, complete: false, conflict: true });
    expect(result.distanceKm).toBeNull();
  });
});

describe("defaultVehicleForLogging — authoritative assignment, never a guess", () => {
  const vehicles = [{ id: "veh_1" }, { id: "veh_2" }];

  it("uses the vehicle of the driver's active assignment", () => {
    expect(
      defaultVehicleForLogging({
        assignment: { vehicleId: "veh_2", status: "ACTIVE" },
        vehicles,
      }),
    ).toBe("veh_2");
  });

  it("requires an intentional choice when there is no active assignment", () => {
    // Never fall back to the first vehicle in the list.
    expect(defaultVehicleForLogging({ assignment: null, vehicles })).toBe("");
    expect(
      defaultVehicleForLogging({
        assignment: { vehicleId: "veh_2", status: "COMPLETED" },
        vehicles,
      }),
    ).toBe("");
    expect(
      defaultVehicleForLogging({
        assignment: { vehicleId: "veh_2", status: "CANCELLED" },
        vehicles,
      }),
    ).toBe("");
  });

  it("ignores an assignment whose vehicle is not in the authoritative list", () => {
    expect(
      defaultVehicleForLogging({
        assignment: { vehicleId: "veh_missing", status: "ACTIVE" },
        vehicles,
      }),
    ).toBe("");
  });
});
