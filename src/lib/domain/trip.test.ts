import { describe, expect, it } from "vitest";

import {
  checkReconciliation,
  computeActualDistance,
  computeEffectiveDistanceM,
  computeEstimatedProjection,
  findReconciliationFlags,
  deriveOriginDestination,
  resolveOriginDestination,
  generateIdempotencyKey,
  generateStopId,
  getTripDistanceMetres,
  markRouteStale,
  TRIP_ACTIONS,
  TRIP_PURPOSES,
  TRIP_STATUSES,
  validateStop,
  validateTripCompletion,
  validateTripForSave,
  type Trip,
  type TripStop,
} from "@/lib/domain/trip";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStop(overrides: Partial<TripStop> = {}): TripStop {
  return {
    id: generateStopId(),
    sequence: 0,
    type: "ORIGIN",
    label: "Accra Office",
    address: null,
    latitude: 5.6037,
    longitude: -0.187,
    placeId: null,
    purpose: null,
    notes: null,
    arrivedAt: null,
    departedAt: null,
    ...overrides,
  };
}

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  const origin = makeStop({ type: "ORIGIN", sequence: 0 });
  const dest = makeStop({
    id: generateStopId(),
    type: "DESTINATION",
    sequence: 1,
    label: "Kotoka Airport",
    latitude: 5.6052,
    longitude: -0.1668,
  });
  return {
    id: "trip-1",
    vehicleId: "v1",
    driverUserId: "d1",
    assignmentId: "a1",
    recordedByUserId: "d1",
    tripDate: "2026-10-10",
    purpose: "TOUR",
    externalReference: null,
    notes: null,
    status: "DRAFT",
    origin,
    destination: dest,
    stops: [origin, dest],
    routeDistanceM: null,
    routeDistanceKm: null,
    routeDurationS: null,
    routingProvider: null,
    routeCalculatedAt: null,
    routeProviderMeta: null,
    routeLegs: [],
    startOdometerKm: null,
    endOdometerKm: null,
    actualDistanceKm: null,
    distanceBasis: "ROUTE_ESTIMATE",
    manualDistanceKm: null,
    manualDistanceReason: null,
    routeStale: false,
    startedAt: "2026-10-10T08:00:00.000Z",
    completedAt: null,
    idempotencyKey: "key1",
    createdAt: "2026-10-10T07:00:00.000Z",
    updatedAt: "2026-10-10T07:00:00.000Z",
    createdBy: "d1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Statuses and constants
// ---------------------------------------------------------------------------

describe("trip constants", () => {
  it("defines DRAFT, COMPLETED, CANCELLED statuses", () => {
    expect(TRIP_STATUSES).toEqual(["DRAFT", "COMPLETED", "CANCELLED"]);
  });

  it("defines standard trip purposes", () => {
    expect(TRIP_PURPOSES).toContain("TOUR");
    expect(TRIP_PURPOSES).toContain("TRANSFER");
    expect(TRIP_PURPOSES).toContain("AIRPORT_PICKUP");
    expect(TRIP_PURPOSES).toContain("MAINTENANCE");
    expect(TRIP_PURPOSES.length).toBeGreaterThanOrEqual(5);
  });

  it("defines lifecycle actions", () => {
    expect(TRIP_ACTIONS.complete.from).toEqual(["DRAFT"]);
    expect(TRIP_ACTIONS.complete.to).toBe("COMPLETED");
    expect(TRIP_ACTIONS.cancel.from).toEqual(["DRAFT"]);
    expect(TRIP_ACTIONS.cancel.to).toBe("CANCELLED");
  });
});

// ---------------------------------------------------------------------------
// Stop validation
// ---------------------------------------------------------------------------

describe("validateStop", () => {
  it("accepts a valid stop with label and sequence", () => {
    expect(validateStop(makeStop())).toEqual({ ok: true });
  });

  it("accepts a stop without coordinates", () => {
    expect(validateStop(makeStop({ latitude: null, longitude: null }))).toEqual({ ok: true });
  });

  it("rejects a stop without a label", () => {
    expect(validateStop({ ...makeStop(), label: "" }).ok).toBe(false);
  });

  it("rejects a stop with negative sequence", () => {
    expect(validateStop({ ...makeStop(), sequence: -1 }).ok).toBe(false);
  });

  it("rejects out-of-range latitude", () => {
    expect(validateStop({ ...makeStop(), latitude: 91 }).ok).toBe(false);
    expect(validateStop({ ...makeStop(), latitude: -91 }).ok).toBe(false);
  });

  it("rejects out-of-range longitude", () => {
    expect(validateStop({ ...makeStop(), longitude: 181 }).ok).toBe(false);
    expect(validateStop({ ...makeStop(), longitude: -181 }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Trip validation
// ---------------------------------------------------------------------------

describe("validateTripForSave", () => {
  it("accepts a valid trip with origin and destination", () => {
    const trip = makeTrip();
    expect(validateTripForSave(trip)).toEqual({ ok: true });
  });

  it("requires vehicleId", () => {
    expect(validateTripForSave({ ...makeTrip(), vehicleId: "" }).ok).toBe(false);
  });

  it("requires driverUserId", () => {
    expect(validateTripForSave({ ...makeTrip(), driverUserId: "" }).ok).toBe(false);
  });

  it("requires a valid tripDate", () => {
    expect(validateTripForSave({ ...makeTrip(), tripDate: "" }).ok).toBe(false);
    expect(validateTripForSave({ ...makeTrip(), tripDate: "invalid" }).ok).toBe(false);
  });

  it("requires at least 2 stops", () => {
    expect(validateTripForSave({ ...makeTrip(), stops: [makeStop()] }).ok).toBe(false);
  });

  it("requires an ORIGIN stop", () => {
    const trip = makeTrip();
    trip.stops = [
      makeStop({ type: "DESTINATION" }),
      makeStop({ id: generateStopId(), type: "DESTINATION", sequence: 1 }),
    ];
    expect(validateTripForSave(trip).ok).toBe(false);
  });

  it("requires a DESTINATION stop", () => {
    const trip = makeTrip();
    trip.stops = [
      makeStop({ type: "ORIGIN" }),
      makeStop({ id: generateStopId(), type: "ORIGIN", sequence: 1 }),
    ];
    expect(validateTripForSave(trip).ok).toBe(false);
  });

  it("rejects manual distance without reason", () => {
    expect(
      validateTripForSave({
        ...makeTrip(),
        distanceBasis: "MANUAL_OVERRIDE",
        manualDistanceKm: 50,
        manualDistanceReason: "",
      }).ok,
    ).toBe(false);
  });

  it("accepts manual distance with a reason", () => {
    expect(
      validateTripForSave({
        ...makeTrip(),
        distanceBasis: "MANUAL_OVERRIDE",
        manualDistanceKm: 50,
        manualDistanceReason: "Provider outage",
      }).ok,
    ).toBe(true);
  });

  it("rejects stops with only latitude (missing longitude)", () => {
    expect(validateStop({ ...makeStop(), longitude: null }).ok).toBe(false);
  });

  it("rejects stops with only longitude (missing latitude)", () => {
    expect(validateStop({ ...makeStop(), latitude: null }).ok).toBe(false);
  });

  it("rejects duplicate stop IDs", () => {
    const trip = makeTrip();
    trip.stops = [
      makeStop({ id: "same-id", type: "ORIGIN", sequence: 0 }),
      makeStop({ id: "same-id", type: "DESTINATION", sequence: 1 }),
    ];
    const result = validateTripForSave(trip);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("unique");
  });

  it("rejects non-contiguous sequence numbers", () => {
    const trip = makeTrip();
    trip.stops[0].sequence = 0;
    trip.stops[1].sequence = 5; // gap
    const result = validateTripForSave(trip);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("contiguous");
  });

  it("rejects origin not at sequence 0", () => {
    const trip = makeTrip();
    trip.stops[0].type = "DESTINATION";
    trip.stops[1].type = "ORIGIN";
    const result = validateTripForSave(trip);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("first");
  });

  it("rejects multiple origins", () => {
    const trip = makeTrip();
    trip.stops = [
      makeStop({ type: "ORIGIN", sequence: 0 }),
      makeStop({ id: "s2", type: "ORIGIN", sequence: 1, label: "Another" }),
    ];
    const result = validateTripForSave(trip);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("exactly one ORIGIN");
  });
});

// ---------------------------------------------------------------------------
// Trip completion validation
// ---------------------------------------------------------------------------

describe("validateTripCompletion", () => {
  it("allows completing a DRAFT trip with a valid route distance", () => {
    expect(
      validateTripCompletion(makeTrip({ routeDistanceM: 50000, routeDistanceKm: 50 })),
    ).toEqual({ ok: true });
  });

  it("rejects completing a COMPLETED trip", () => {
    expect(validateTripCompletion(makeTrip({ status: "COMPLETED" })).ok).toBe(false);
  });

  it("rejects completing a CANCELLED trip", () => {
    expect(validateTripCompletion(makeTrip({ status: "CANCELLED" })).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Idempotency key
// ---------------------------------------------------------------------------

describe("generateIdempotencyKey", () => {
  it("generates a deterministic key from vehicle, driver, date, and stops", () => {
    const stops = [makeStop({ id: "s1", sequence: 0 }), makeStop({ id: "s2", sequence: 1 })];
    const key1 = generateIdempotencyKey("v1", "d1", "2026-10-10", stops);
    const key2 = generateIdempotencyKey("v1", "d1", "2026-10-10", stops);
    expect(key1).toBe(key2);
    expect(key1).toHaveLength(32);
  });

  it("produces different keys for different vehicles", () => {
    const stops = [makeStop({ id: "s1" }), makeStop({ id: "s2", sequence: 1 })];
    const key1 = generateIdempotencyKey("v1", "d1", "2026-10-10", stops);
    const key2 = generateIdempotencyKey("v2", "d1", "2026-10-10", stops);
    expect(key1).not.toBe(key2);
  });

  it("produces different keys for different dates", () => {
    const stops = [makeStop({ id: "s1" }), makeStop({ id: "s2", sequence: 1 })];
    const key1 = generateIdempotencyKey("v1", "d1", "2026-10-10", stops);
    const key2 = generateIdempotencyKey("v1", "d1", "2026-10-11", stops);
    expect(key1).not.toBe(key2);
  });

  it("sorts stops by sequence before hashing", () => {
    const stops1 = [makeStop({ id: "s1", sequence: 0 }), makeStop({ id: "s2", sequence: 1 })];
    const stops2 = [makeStop({ id: "s2", sequence: 1 }), makeStop({ id: "s1", sequence: 0 })];
    const key1 = generateIdempotencyKey("v1", "d1", "2026-10-10", stops1);
    const key2 = generateIdempotencyKey("v1", "d1", "2026-10-10", stops2);
    expect(key1).toBe(key2);
  });
});

// ---------------------------------------------------------------------------
// Route staleness
// ---------------------------------------------------------------------------

describe("markRouteStale", () => {
  it("sets routeStale to true", () => {
    const trip = makeTrip();
    expect(trip.routeStale).toBe(false);
    const stale = markRouteStale(trip);
    expect(stale.routeStale).toBe(true);
  });

  it("updates updatedAt", () => {
    const trip = makeTrip({ updatedAt: "2026-01-01T00:00:00.000Z" });
    const stale = markRouteStale(trip);
    expect(stale.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Actual distance computation
// ---------------------------------------------------------------------------

describe("computeActualDistance", () => {
  it("returns null when either reading is missing", () => {
    expect(computeActualDistance(null, 100)).toBeNull();
    expect(computeActualDistance(50, null)).toBeNull();
    expect(computeActualDistance(null, null)).toBeNull();
  });

  it("returns the delta when both readings are valid", () => {
    expect(computeActualDistance(100, 150)).toBe(50);
  });

  it("returns null when end is below start", () => {
    expect(computeActualDistance(150, 100)).toBeNull();
  });

  it("returns 0 when start equals end", () => {
    expect(computeActualDistance(100, 100)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Derive origin and destination
// ---------------------------------------------------------------------------

describe("deriveOriginDestination", () => {
  it("finds the ORIGIN and DESTINATION stops", () => {
    const origin = makeStop({ type: "ORIGIN", sequence: 0 });
    const intermediate = makeStop({
      id: "s2",
      type: "INTERMEDIATE",
      sequence: 1,
      label: "Airport",
    });
    const dest = makeStop({ id: "s3", type: "DESTINATION", sequence: 2, label: "Hotel" });
    const { origin: o, destination: d } = deriveOriginDestination([origin, intermediate, dest]);
    expect(o.id).toBe(origin.id);
    expect(d.id).toBe(dest.id);
  });

  it("throws when no ORIGIN is present", () => {
    const dest = makeStop({ type: "DESTINATION" });
    expect(() => deriveOriginDestination([dest])).toThrow("No ORIGIN");
  });

  it("throws when no DESTINATION is present", () => {
    const origin = makeStop({ type: "ORIGIN" });
    expect(() => deriveOriginDestination([origin])).toThrow("No DESTINATION");
  });
});

describe("resolveOriginDestination (read path — never throws)", () => {
  // Regression guard for the /trips 500. `toTrip` maps every stored document;
  // a legacy row predating the stop-`type` field (or a hand-edited doc that
  // lost its ORIGIN/DESTINATION markers) has ≥2 stops but no markers. The
  // strict `deriveOriginDestination` threw and 500'd the whole list page. The
  // read path must degrade to positional first/last instead.
  it("returns the marked stops when both markers are present", () => {
    const origin = makeStop({ type: "ORIGIN", sequence: 0 });
    const intermediate = makeStop({ id: "s2", type: "INTERMEDIATE", sequence: 1 });
    const dest = makeStop({ id: "s3", type: "DESTINATION", sequence: 2 });
    const { origin: o, destination: d } = resolveOriginDestination([origin, intermediate, dest]);
    expect(o.id).toBe(origin.id);
    expect(d.id).toBe(dest.id);
  });

  it("falls back to positional first/last when NO markers exist (legacy doc)", () => {
    // A pre-`type` document: every stop is effectively untyped.
    const stops = [
      makeStop({ type: "INTERMEDIATE" as TripStop["type"], sequence: 0, label: "Start" }),
      makeStop({ id: "s2", type: "INTERMEDIATE" as TripStop["type"], sequence: 1, label: "Mid" }),
      makeStop({ id: "s3", type: "INTERMEDIATE" as TripStop["type"], sequence: 2, label: "End" }),
    ];
    const { origin, destination } = resolveOriginDestination(stops);
    // Does not throw…
    expect(origin.label).toBe("Start");
    expect(destination.label).toBe("End");
  });

  it("respects sequence order, not array order, when falling back", () => {
    const stops = [
      makeStop({ id: "late", type: "INTERMEDIATE" as TripStop["type"], sequence: 2, label: "End" }),
      makeStop({
        id: "early",
        type: "INTERMEDIATE" as TripStop["type"],
        sequence: 0,
        label: "Start",
      }),
    ];
    const { origin, destination } = resolveOriginDestination(stops);
    expect(origin.id).toBe("early");
    expect(destination.id).toBe("late");
  });

  it("uses a present marker over position when only one marker exists", () => {
    const untypedFirst = makeStop({
      type: "INTERMEDIATE" as TripStop["type"],
      sequence: 0,
      label: "First",
    });
    const markedDest = makeStop({
      id: "s9",
      type: "DESTINATION",
      sequence: 1,
      label: "Marked end",
    });
    const { origin, destination } = resolveOriginDestination([untypedFirst, markedDest]);
    // Origin has no marker → positional first.
    expect(origin.label).toBe("First");
    // Destination marker wins over the positional last.
    expect(destination.id).toBe(markedDest.id);
  });

  it("returns empty placeholders for a degenerate single/empty stop list", () => {
    // Never index undefined; callers get a renderable (if empty) object.
    const single = [makeStop({ type: "INTERMEDIATE" as TripStop["type"], sequence: 0 })];
    const one = resolveOriginDestination(single);
    expect(one.origin.id).toBe(single[0]?.id);
    expect(one.destination.id).toBe(single[0]?.id);
  });
});

// ---------------------------------------------------------------------------
// Estimated projection
// ---------------------------------------------------------------------------

describe("computeEstimatedProjection", () => {
  it("returns baseline when there are no completed trips", () => {
    const result = computeEstimatedProjection(1000, "2026-10-01T00:00:00.000Z", []);
    expect(result.estimatedKm).toBe(1000);
    expect(result.tripCount).toBe(0);
    expect(result.totalRouteM).toBe(0);
  });

  it("adds completed trip route distance to baseline", () => {
    const trips = [
      makeTrip({
        status: "COMPLETED",
        completedAt: "2026-10-05T12:00:00.000Z",
        routeDistanceM: 25000,
      }),
    ];
    const result = computeEstimatedProjection(1000, "2026-10-01T00:00:00.000Z", trips);
    expect(result.estimatedKm).toBe(1025);
    expect(result.tripCount).toBe(1);
    expect(result.totalRouteM).toBe(25000);
  });

  it("does not count DRAFT trips", () => {
    const trips = [
      makeTrip({
        status: "DRAFT",
        completedAt: null,
        routeDistanceM: 25000,
      }),
    ];
    const result = computeEstimatedProjection(1000, "2026-10-01T00:00:00.000Z", trips);
    expect(result.estimatedKm).toBe(1000);
    expect(result.tripCount).toBe(0);
  });

  it("does not count CANCELLED trips", () => {
    const trips = [
      makeTrip({
        status: "CANCELLED",
        completedAt: "2026-10-05T12:00:00.000Z",
        routeDistanceM: 25000,
      }),
    ];
    const result = computeEstimatedProjection(1000, "2026-10-01T00:00:00.000Z", trips);
    expect(result.estimatedKm).toBe(1000);
    expect(result.tripCount).toBe(0);
  });

  it("does not count trips with journey date before the baseline", () => {
    const trips = [
      makeTrip({
        status: "COMPLETED",
        tripDate: "2026-09-28",
        completedAt: "2026-10-12T12:00:00.000Z", // recorded later
        routeDistanceM: 25000,
      }),
    ];
    const result = computeEstimatedProjection(1000, "2026-10-01T00:00:00.000Z", trips);
    expect(result.estimatedKm).toBe(1000);
    expect(result.tripCount).toBe(0);
  });

  it("does not count trips on the same date as the baseline", () => {
    const trips = [
      makeTrip({
        status: "COMPLETED",
        tripDate: "2026-10-01", // same date as baseline
        completedAt: "2026-10-12T12:00:00.000Z",
        routeDistanceM: 25000,
      }),
    ];
    const result = computeEstimatedProjection(1000, "2026-10-01T00:00:00.000Z", trips);
    expect(result.estimatedKm).toBe(1000);
    expect(result.tripCount).toBe(0);
  });

  it("counts trips with journey date after the baseline regardless of when recorded", () => {
    const trips = [
      makeTrip({
        status: "COMPLETED",
        tripDate: "2026-10-05", // journey after baseline
        completedAt: "2026-10-12T12:00:00.000Z", // recorded later
        routeDistanceM: 25000,
      }),
    ];
    const result = computeEstimatedProjection(1000, "2026-10-01T00:00:00.000Z", trips);
    expect(result.estimatedKm).toBe(1025);
    expect(result.tripCount).toBe(1);
  });

  it("uses actual distance when route distance is missing", () => {
    const trips = [
      makeTrip({
        status: "COMPLETED",
        completedAt: "2026-10-05T12:00:00.000Z",
        routeDistanceM: null,
        actualDistanceKm: 30,
      }),
    ];
    const result = computeEstimatedProjection(1000, "2026-10-01T00:00:00.000Z", trips);
    expect(result.estimatedKm).toBe(1030);
    expect(result.totalRouteM).toBe(30000);
  });

  it("uses manual distance as last resort", () => {
    const trips = [
      makeTrip({
        status: "COMPLETED",
        completedAt: "2026-10-05T12:00:00.000Z",
        routeDistanceM: null,
        actualDistanceKm: null,
        manualDistanceKm: 20,
        distanceBasis: "MANUAL_OVERRIDE",
      }),
    ];
    const result = computeEstimatedProjection(1000, "2026-10-01T00:00:00.000Z", trips);
    expect(result.estimatedKm).toBe(1020);
  });

  it("sums multiple eligible trips", () => {
    const trips = [
      makeTrip({
        id: "t1",
        status: "COMPLETED",
        completedAt: "2026-10-05T12:00:00.000Z",
        routeDistanceM: 15000,
      }),
      makeTrip({
        id: "t2",
        status: "COMPLETED",
        completedAt: "2026-10-06T12:00:00.000Z",
        routeDistanceM: 25000,
      }),
    ];
    const result = computeEstimatedProjection(1000, "2026-10-01T00:00:00.000Z", trips);
    expect(result.estimatedKm).toBe(1040);
    expect(result.tripCount).toBe(2);
    expect(result.totalRouteM).toBe(40000);
  });

  it("rounds to 2 decimal places", () => {
    const trips = [
      makeTrip({
        status: "COMPLETED",
        completedAt: "2026-10-05T12:00:00.000Z",
        routeDistanceM: 12345,
      }),
    ];
    const result = computeEstimatedProjection(1000, "2026-10-01T00:00:00.000Z", trips);
    // 1000 + 12.345 = 1012.345 → 1012.35
    expect(result.estimatedKm).toBe(1012.35);
  });

  it("prefers actual odometer over route estimate in projection", () => {
    const trips = [
      makeTrip({
        status: "COMPLETED",
        completedAt: "2026-10-05T12:00:00.000Z",
        routeDistanceM: 50000,
        actualDistanceKm: 48,
        distanceBasis: "ACTUAL_ODOMETER",
      }),
    ];
    const result = computeEstimatedProjection(1000, "2026-10-01T00:00:00.000Z", trips);
    expect(result.estimatedKm).toBe(1048);
    expect(result.totalRouteM).toBe(48000);
  });
});

describe("getTripDistanceMetres", () => {
  it("returns null for a trip with no distance data", () => {
    const trip = makeTrip({ routeDistanceM: null, actualDistanceKm: null, manualDistanceKm: null });
    expect(getTripDistanceMetres(trip)).toBeNull();
  });

  it("prefers actual odometer when available", () => {
    const trip = makeTrip({
      routeDistanceM: 50000,
      actualDistanceKm: 48,
      distanceBasis: "ACTUAL_ODOMETER",
    });
    expect(getTripDistanceMetres(trip)).toBe(48000);
  });

  it("uses manual override when explicitly authorized", () => {
    const trip = makeTrip({
      routeDistanceM: 50000,
      actualDistanceKm: null,
      manualDistanceKm: 45,
      distanceBasis: "MANUAL_OVERRIDE",
    });
    expect(getTripDistanceMetres(trip)).toBe(45000);
  });

  it("falls back to route estimate", () => {
    const trip = makeTrip({
      routeDistanceM: 50000,
      actualDistanceKm: null,
      manualDistanceKm: null,
      distanceBasis: "ROUTE_ESTIMATE",
    });
    expect(getTripDistanceMetres(trip)).toBe(50000);
  });

  it("ignores zero or negative values", () => {
    const trip = makeTrip({ routeDistanceM: 0, actualDistanceKm: 0, manualDistanceKm: 0 });
    expect(getTripDistanceMetres(trip)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reconciliation flagging
// ---------------------------------------------------------------------------

describe("checkReconciliation", () => {
  it("flags a trip with >20% discrepancy between route and actual", () => {
    const trip = makeTrip({
      routeDistanceM: 100000,
      actualDistanceKm: 70,
      distanceBasis: "ACTUAL_ODOMETER",
    });
    const flag = checkReconciliation(trip);
    expect(flag.severity).toBe("FLAGGED");
    expect(flag.discrepancyPct).toBeGreaterThan(20);
  });

  it("does not flag a trip with <20% discrepancy", () => {
    const trip = makeTrip({
      routeDistanceM: 100000,
      actualDistanceKm: 95,
      distanceBasis: "ACTUAL_ODOMETER",
    });
    const flag = checkReconciliation(trip);
    expect(flag.severity).toBe("OK");
  });

  it("does not flag a very short trip below minimum distance", () => {
    const trip = makeTrip({
      routeDistanceM: 300,
      actualDistanceKm: 0.2,
      distanceBasis: "ACTUAL_ODOMETER",
    });
    const flag = checkReconciliation(trip);
    expect(flag.severity).toBe("OK");
    expect(flag.note).toContain("Short trip");
  });

  it("handles missing actual distance gracefully", () => {
    const trip = makeTrip({
      routeDistanceM: 100000,
      actualDistanceKm: null,
    });
    const flag = checkReconciliation(trip);
    expect(flag.severity).toBe("OK");
    expect(flag.note).toContain("No actual odometer reading");
  });

  it("handles missing route estimate gracefully", () => {
    const trip = makeTrip({
      routeDistanceM: null,
      actualDistanceKm: 50,
    });
    const flag = checkReconciliation(trip);
    expect(flag.severity).toBe("OK");
    expect(flag.note).toContain("No route estimate");
  });

  it("findReconciliationFlags returns only flagged trips", () => {
    const trips = [
      makeTrip({
        id: "t1",
        status: "COMPLETED",
        routeDistanceM: 100000,
        actualDistanceKm: 70,
        distanceBasis: "ACTUAL_ODOMETER",
      }),
      makeTrip({
        id: "t2",
        status: "COMPLETED",
        routeDistanceM: 100000,
        actualDistanceKm: 95,
        distanceBasis: "ACTUAL_ODOMETER",
      }),
    ];
    const flags = findReconciliationFlags(trips);
    expect(flags).toHaveLength(1);
    expect(flags[0].tripId).toBe("t1");
  });
});

describe("computeEffectiveDistanceM", () => {
  it("prefers actual odometer over route estimate", () => {
    expect(
      computeEffectiveDistanceM({
        actualDistanceKm: 50,
        routeDistanceM: 80000,
        routeStale: false,
        manualDistanceKm: null,
        distanceBasis: "ROUTE_ESTIMATE",
      }),
    ).toBe(50000);
  });

  it("uses manual override when set", () => {
    expect(
      computeEffectiveDistanceM({
        actualDistanceKm: null,
        routeDistanceM: null,
        routeStale: false,
        manualDistanceKm: 42,
        distanceBasis: "MANUAL_OVERRIDE",
      }),
    ).toBe(42000);
  });

  it("uses route estimate when not stale", () => {
    expect(
      computeEffectiveDistanceM({
        actualDistanceKm: null,
        routeDistanceM: 75000,
        routeStale: false,
        manualDistanceKm: null,
        distanceBasis: "ROUTE_ESTIMATE",
      }),
    ).toBe(75000);
  });

  it("rejects stale route estimate", () => {
    expect(
      computeEffectiveDistanceM({
        actualDistanceKm: null,
        routeDistanceM: 75000,
        routeStale: true,
        manualDistanceKm: null,
        distanceBasis: "ROUTE_ESTIMATE",
      }),
    ).toBeNull();
  });

  it("returns null when no basis is available", () => {
    expect(
      computeEffectiveDistanceM({
        actualDistanceKm: null,
        routeDistanceM: null,
        routeStale: false,
        manualDistanceKm: null,
        distanceBasis: "ROUTE_ESTIMATE",
      }),
    ).toBeNull();
  });
});

describe("validateTripCompletion — distance basis requirement", () => {
  it("rejects completion without any distance basis", () => {
    const trip = makeTrip({ routeDistanceM: null, routeDistanceKm: null });
    const result = validateTripCompletion(trip);
    expect(result.ok).toBe(false);
  });

  it("rejects completion with stale route and no alternative", () => {
    const trip = makeTrip({
      routeDistanceM: 50000,
      routeDistanceKm: 50,
      routeStale: true,
      actualDistanceKm: null,
      manualDistanceKm: null,
    });
    const result = validateTripCompletion(trip);
    expect(result.ok).toBe(false);
  });

  it("allows completion with stale route when actual odometer exists", () => {
    const trip = makeTrip({
      routeDistanceM: 50000,
      routeDistanceKm: 50,
      routeStale: true,
      actualDistanceKm: 48,
    });
    const result = validateTripCompletion(trip);
    expect(result.ok).toBe(true);
  });

  it("allows completion with manual override", () => {
    const trip = makeTrip({
      routeDistanceM: null,
      routeDistanceKm: null,
      manualDistanceKm: 55,
      manualDistanceReason: "Authorized by supervisor",
      distanceBasis: "MANUAL_OVERRIDE",
    });
    const result = validateTripCompletion(trip);
    expect(result.ok).toBe(true);
  });
});
describe("validateTripCompletion — odometer validation", () => {
  it("rejects completion when end odometer is below start odometer", () => {
    const trip = makeTrip({
      startOdometerKm: 85000,
      endOdometerKm: 84900,
      routeDistanceM: 50000,
      routeDistanceKm: 50,
    });
    const result = validateTripCompletion(trip);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("cannot be less than start odometer");
  });

  it("rejects completion when end odometer is below start even with route estimate", () => {
    const trip = makeTrip({
      startOdometerKm: 85000,
      endOdometerKm: 84900,
      routeDistanceM: 50000,
      routeDistanceKm: 50,
      actualDistanceKm: null,
    });
    const result = validateTripCompletion(trip);
    expect(result.ok).toBe(false);
  });

  it("rejects negative odometer readings", () => {
    const trip = makeTrip({
      startOdometerKm: -100,
      endOdometerKm: 50,
      routeDistanceM: 50000,
    });
    const result = validateTripCompletion(trip);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("negative");
  });

  it("allows completion when end equals start (zero distance)", () => {
    const trip = makeTrip({
      startOdometerKm: 85000,
      endOdometerKm: 85000,
      routeDistanceM: 50000,
      routeDistanceKm: 50,
    });
    const result = validateTripCompletion(trip);
    expect(result.ok).toBe(true);
  });

  it("allows completion with valid odometer readings", () => {
    const trip = makeTrip({
      startOdometerKm: 85000,
      endOdometerKm: 85050,
      routeDistanceM: 50000,
      routeDistanceKm: 50,
    });
    const result = validateTripCompletion(trip);
    expect(result.ok).toBe(true);
  });
});
