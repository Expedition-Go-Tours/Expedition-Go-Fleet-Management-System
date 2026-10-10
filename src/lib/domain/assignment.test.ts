import { describe, expect, it } from "vitest";

import { computeTripDistance } from "@/lib/domain/assignment";

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
