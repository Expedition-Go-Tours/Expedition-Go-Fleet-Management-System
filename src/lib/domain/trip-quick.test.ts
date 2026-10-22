import { describe, expect, it } from "vitest";

import {
  buildTripDraft,
  parseOdometerReading,
  planQuickTrip,
  type TripDraftInput,
  type TripStop,
} from "@/lib/domain/trip";

/*
 * Fast path contract: two place names + the odometer pair are enough to save
 * and complete a trip, with the distance coming from the odometer delta.
 * These tests pin where the trip gets its mileage and that a bad pair is
 * rejected rather than silently rounded into something plausible.
 */

function stop(
  id: string,
  type: TripStop["type"],
  sequence: number,
  label: string,
  extra: Partial<TripStop> = {},
): TripStop {
  return {
    id,
    sequence,
    type,
    label,
    address: null,
    latitude: null,
    longitude: null,
    placeId: null,
    purpose: null,
    notes: null,
    arrivedAt: null,
    departedAt: null,
    ...extra,
  };
}

function baseInput(overrides: Partial<TripDraftInput> = {}): TripDraftInput {
  return {
    vehicleId: "veh_1",
    driverUserId: "user_1",
    tripDate: "2026-10-22",
    purpose: "TOUR",
    stops: [stop("s1", "ORIGIN", 0, "Kotoka Airport"), stop("s2", "DESTINATION", 1, "Cape Coast")],
    ...overrides,
  };
}

describe("buildTripDraft", () => {
  it("builds the save body with trimmed values and normalised sequence", () => {
    const result = buildTripDraft(
      baseInput({
        externalReference: "  BK-2026-0042  ",
        notes: "  Two passengers  ",
        stops: [
          stop("s1", "ORIGIN", 4, "  Kotoka Airport  "),
          stop("s2", "DESTINATION", 9, "  Cape Coast  "),
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.stops.map((s) => s.sequence)).toEqual([0, 1]);
    expect(result.draft.stops[0]?.label).toBe("Kotoka Airport");
    expect(result.draft.stops[1]?.label).toBe("Cape Coast");
    expect(result.draft.externalReference).toBe("BK-2026-0042");
    expect(result.draft.notes).toBe("Two passengers");
  });

  it("omits optional fields rather than sending empty strings", () => {
    const result = buildTripDraft(
      baseInput({ externalReference: "   ", notes: "", assignmentId: "" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.externalReference).toBeUndefined();
    expect(result.draft.notes).toBeUndefined();
    expect(result.draft.assignmentId).toBeUndefined();
  });

  it("reports every missing fact at once, against the right field", () => {
    const result = buildTripDraft(
      baseInput({
        vehicleId: " ",
        tripDate: "22/10/2026",
        stops: [stop("s1", "ORIGIN", 0, ""), stop("s2", "DESTINATION", 1, "")],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.vehicleId).toBeTruthy();
    expect(result.errors.tripDate).toBeTruthy();
    expect(result.errors.origin).toBeTruthy();
    expect(result.errors.destination).toBeTruthy();
  });

  it("needs the first stop to be the origin and the last the destination", () => {
    const result = buildTripDraft(
      baseInput({
        stops: [stop("s1", "DESTINATION", 0, "Cape Coast"), stop("s2", "ORIGIN", 1, "Accra")],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.origin).toBeTruthy();
    expect(result.errors.destination).toBeTruthy();
  });

  it("rejects an unnamed intermediate stop", () => {
    const result = buildTripDraft(
      baseInput({
        stops: [
          stop("s1", "ORIGIN", 0, "Accra"),
          stop("s2", "INTERMEDIATE", 1, "   "),
          stop("s3", "DESTINATION", 2, "Kumasi"),
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.stops).toBeTruthy();
  });

  it("keeps coordinates and addresses — locations survive the fast path", () => {
    const result = buildTripDraft(
      baseInput({
        stops: [
          stop("s1", "ORIGIN", 0, "Kotoka Airport", { latitude: 5.6052, longitude: -0.1668 }),
          stop("s2", "DESTINATION", 1, "Cape Coast", {
            latitude: 5.1315,
            longitude: -1.2795,
            address: "  Cape Coast Castle  ",
          }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.stops[0]?.latitude).toBe(5.6052);
    expect(result.draft.stops[1]?.longitude).toBe(-1.2795);
    expect(result.draft.stops[1]?.address).toBe("Cape Coast Castle");
  });
});

describe("parseOdometerReading", () => {
  it("reads whole kilometres", () => {
    expect(parseOdometerReading("0")).toBe(0);
    expect(parseOdometerReading("1234")).toBe(1234);
    expect(parseOdometerReading(" 88 ")).toBe(88);
    expect(parseOdometerReading(45500)).toBe(45500);
  });

  it("returns null for blank, fractional, negative or text input", () => {
    expect(parseOdometerReading("")).toBeNull();
    expect(parseOdometerReading("   ")).toBeNull();
    expect(parseOdometerReading(null)).toBeNull();
    expect(parseOdometerReading(undefined)).toBeNull();
    expect(parseOdometerReading("12.5")).toBeNull();
    expect(parseOdometerReading("-1")).toBeNull();
    expect(parseOdometerReading("abc")).toBeNull();
  });
});

describe("planQuickTrip", () => {
  it("completes with both readings, giving an actual-distance basis", () => {
    const plan = planQuickTrip({
      ...baseInput(),
      startOdometerKm: "45120",
      endOdometerKm: "45158",
    });

    expect(plan.ok).toBe(true);
    expect(plan.distanceKm).toBe(38);
    expect(plan.completion).toEqual({ startOdometerKm: 45120, endOdometerKm: 45158 });
    expect(plan.draft?.stops).toHaveLength(2);
  });

  it("requires both readings", () => {
    for (const [start, end] of [
      ["", "45158"],
      ["45120", ""],
      ["", ""],
    ]) {
      const plan = planQuickTrip({ ...baseInput(), startOdometerKm: start, endOdometerKm: end });
      expect(plan.ok).toBe(false);
      expect(plan.errors.odometers).toBeTruthy();
      expect(plan.completion).toBeNull();
      expect(plan.draft).toBeNull();
    }
  });

  it("rejects a zero or reversed pair instead of crediting a wrong distance", () => {
    for (const [start, end] of [
      ["45120", "45120"],
      ["45158", "45120"],
    ]) {
      const plan = planQuickTrip({ ...baseInput(), startOdometerKm: start, endOdometerKm: end });
      expect(plan.ok).toBe(false);
      expect(plan.errors.odometers).toBeTruthy();
      expect(plan.distanceKm).toBeNull();
    }
  });

  it("rejects fractional and negative readings", () => {
    for (const [start, end] of [
      ["45120.5", "45158"],
      ["-1", "45158"],
    ]) {
      const plan = planQuickTrip({ ...baseInput(), startOdometerKm: start, endOdometerKm: end });
      expect(plan.ok).toBe(false);
      expect(plan.errors.odometers).toBeTruthy();
    }
  });

  it("still reports place errors alongside a valid odometer pair", () => {
    const plan = planQuickTrip({
      ...baseInput({
        stops: [stop("s1", "ORIGIN", 0, " "), stop("s2", "DESTINATION", 1, "Cape Coast")],
      }),
      startOdometerKm: "45120",
      endOdometerKm: "45158",
    });
    expect(plan.ok).toBe(false);
    expect(plan.errors.origin).toBeTruthy();
    expect(plan.errors.odometers).toBeUndefined();
    expect(plan.draft).toBeNull();
  });
});
