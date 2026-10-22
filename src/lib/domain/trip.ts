import { createHash } from "crypto";

import { PERMISSIONS } from "@/lib/auth/permissions";
import type { ActionMap } from "@/lib/domain/lifecycle";

/*
 * Trip domain model.
 *
 * A Trip records a single journey made by a driver in a vehicle. It captures
 * origin/destination stops, route distance (from a routing provider or
 * manual entry), and optionally odometer-based actual distance. The trip
 * feeds into the vehicle's estimated-kilometre projection.
 *
 * The domain model is pure — no I/O, no Firestore references.
 */

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

export const TRIP_STATUSES = ["DRAFT", "COMPLETED", "CANCELLED"] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

// ---------------------------------------------------------------------------
// Purposes
// ---------------------------------------------------------------------------

export const TRIP_PURPOSES = [
  "TOUR",
  "TRANSFER",
  "AIRPORT_PICKUP",
  "DROPOFF",
  "STAFF_OPERATION",
  "MAINTENANCE",
  "ERRAND",
  "OTHER",
] as const;
export type TripPurpose = (typeof TRIP_PURPOSES)[number];

// ---------------------------------------------------------------------------
// Distance basis
// ---------------------------------------------------------------------------

export const DISTANCE_BASES = ["ROUTE_ESTIMATE", "ACTUAL_ODOMETER", "MANUAL_OVERRIDE"] as const;
export type DistanceBasis = (typeof DISTANCE_BASES)[number];

// ---------------------------------------------------------------------------
// Trip stop
// ---------------------------------------------------------------------------

export interface TripStop {
  id: string;
  sequence: number;
  type: "ORIGIN" | "INTERMEDIATE" | "DESTINATION";
  label: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  purpose: string | null;
  notes: string | null;
  arrivedAt: string | null;
  departedAt: string | null;
}

// ---------------------------------------------------------------------------
// Route leg
// ---------------------------------------------------------------------------

export interface RouteLeg {
  fromStopId: string;
  toStopId: string;
  sequence: number;
  distanceM: number;
  durationS: number | null;
}

// ---------------------------------------------------------------------------
// Trip
// ---------------------------------------------------------------------------

export interface Trip {
  id: string;
  vehicleId: string;
  driverUserId: string;
  assignmentId: string | null;
  recordedByUserId: string;
  tripDate: string; // ISO date YYYY-MM-DD
  purpose: TripPurpose;
  externalReference: string | null;
  notes: string | null;
  status: TripStatus;

  // Stops
  origin: TripStop;
  destination: TripStop;
  stops: TripStop[];

  // Route calculation
  routeDistanceM: number | null;
  routeDistanceKm: number | null;
  routeDurationS: number | null;
  routingProvider: string | null;
  routeCalculatedAt: string | null;
  routeProviderMeta: unknown | null;
  routeLegs: RouteLeg[];

  // Odometer
  startOdometerKm: number | null;
  endOdometerKm: number | null;
  actualDistanceKm: number | null;

  // Distance basis
  distanceBasis: DistanceBasis;
  manualDistanceKm: number | null;
  manualDistanceReason: string | null;

  // Staleness
  routeStale: boolean;
  /** GeoJSON LineString of the road route, when available. */
  routeGeometry?: { type: string; coordinates: [number, number][] } | null;

  // Timestamps
  startedAt: string | null;
  completedAt: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// Lifecycle actions
// ---------------------------------------------------------------------------

export const TRIP_ACTIONS = {
  complete: {
    permission: PERMISSIONS.TRIP_COMPLETE,
    from: ["DRAFT"],
    to: "COMPLETED",
  },
  cancel: {
    permission: PERMISSIONS.TRIP_COMPLETE,
    from: ["DRAFT"],
    to: "CANCELLED",
  },
} as const satisfies ActionMap<TripStatus>;

// ---------------------------------------------------------------------------
// Validation types
// ---------------------------------------------------------------------------

export type TripValidation = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Validation: stop
// ---------------------------------------------------------------------------

/**
 * Validate a single trip stop. Coordinates are optional (a stop may be a
 * labelled address without lat/lng), but when present they must be valid
 * WGS-84 values.
 */
export function validateStop(stop: Partial<TripStop>): TripValidation {
  if (!stop.label || stop.label.trim().length === 0) {
    return { ok: false, error: "Stop must have a label" };
  }
  if (typeof stop.sequence !== "number" || stop.sequence < 0) {
    return { ok: false, error: "Stop must have a non-negative sequence number" };
  }
  if (stop.latitude !== null && stop.latitude !== undefined) {
    if (typeof stop.latitude !== "number" || stop.latitude < -90 || stop.latitude > 90) {
      return { ok: false, error: "Stop latitude must be between -90 and 90" };
    }
  }
  if (stop.longitude !== null && stop.longitude !== undefined) {
    if (typeof stop.longitude !== "number" || stop.longitude < -180 || stop.longitude > 180) {
      return { ok: false, error: "Stop longitude must be between -180 and 180" };
    }
  }
  // Coordinates must be both present or both absent
  const hasLat = stop.latitude !== null && stop.latitude !== undefined;
  const hasLng = stop.longitude !== null && stop.longitude !== undefined;
  if (hasLat !== hasLng) {
    return { ok: false, error: "Stop must have both latitude and longitude, or neither" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Validation: trip for save
// ---------------------------------------------------------------------------

/**
 * Validate a trip is complete enough to persist. Requires at least an origin
 * and destination stop, valid vehicle/driver references, and a trip date.
 */
export function validateTripForSave(trip: Partial<Trip>): TripValidation {
  if (!trip.vehicleId) {
    return { ok: false, error: "Trip must have a vehicleId" };
  }
  if (!trip.driverUserId) {
    return { ok: false, error: "Trip must have a driverUserId" };
  }
  if (!trip.tripDate || !/^\d{4}-\d{2}-\d{2}$/.test(trip.tripDate)) {
    return { ok: false, error: "Trip must have a valid tripDate (YYYY-MM-DD)" };
  }
  if (!trip.purpose || !(TRIP_PURPOSES as readonly string[]).includes(trip.purpose)) {
    return { ok: false, error: `Trip purpose must be one of: ${TRIP_PURPOSES.join(", ")}` };
  }
  if (!trip.stops || trip.stops.length < 2) {
    return { ok: false, error: "Trip must have at least 2 stops (origin and destination)" };
  }

  // Validate each stop
  for (const stop of trip.stops) {
    const v = validateStop(stop);
    if (!v.ok) return v;
  }

  // Stop IDs must be unique
  const stopIds = new Set(trip.stops.map((s) => s.id));
  if (stopIds.size !== trip.stops.length) {
    return { ok: false, error: "Stop IDs must be unique within a trip" };
  }

  // Sequence values must be unique and contiguous starting from 0
  const sequences = trip.stops.map((s) => s.sequence).sort((a, b) => a - b);
  for (let i = 0; i < sequences.length; i++) {
    if (sequences[i] !== i) {
      return {
        ok: false,
        error: `Stop sequences must be contiguous starting from 0 (expected ${i}, got ${sequences[i]})`,
      };
    }
  }

  // Origin must be first, destination must be last
  const originStop = trip.stops.find((s) => s.type === "ORIGIN");
  const destinationStop = trip.stops.find((s) => s.type === "DESTINATION");
  if (originStop && originStop.sequence !== 0) {
    return { ok: false, error: "ORIGIN stop must be first (sequence 0)" };
  }
  if (destinationStop && destinationStop.sequence !== trip.stops.length - 1) {
    return { ok: false, error: "DESTINATION stop must be last" };
  }

  // Exactly one ORIGIN and one DESTINATION
  const originCount = trip.stops.filter((s) => s.type === "ORIGIN").length;
  const destCount = trip.stops.filter((s) => s.type === "DESTINATION").length;
  if (originCount !== 1) {
    return { ok: false, error: "Trip must have exactly one ORIGIN stop" };
  }
  if (destCount !== 1) {
    return { ok: false, error: "Trip must have exactly one DESTINATION stop" };
  }

  // Manual distance, if set, must be positive
  if (trip.manualDistanceKm !== null && trip.manualDistanceKm !== undefined) {
    if (typeof trip.manualDistanceKm !== "number" || trip.manualDistanceKm <= 0) {
      return { ok: false, error: "Manual distance must be a positive number" };
    }
    if (trip.distanceBasis === "MANUAL_OVERRIDE" && !trip.manualDistanceReason?.trim()) {
      return { ok: false, error: "Manual distance override requires a reason" };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Validation: trip completion
// ---------------------------------------------------------------------------

/**
 * Validate that a trip can be completed. A completed trip must be in DRAFT
 * status and satisfy all save requirements.
 */
export function validateTripCompletion(trip: Trip): TripValidation {
  if (trip.status !== "DRAFT") {
    return { ok: false, error: `Cannot complete a trip with status ${trip.status}` };
  }
  const saveValidation = validateTripForSave(trip);
  if (!saveValidation.ok) return saveValidation;

  // If both odometer readings are supplied, they must be consistent.
  // Reject anomalous readings (end < start) instead of silently falling back
  // to a route estimate or manual override.
  if (trip.startOdometerKm !== null && trip.endOdometerKm !== null) {
    if (trip.startOdometerKm < 0 || trip.endOdometerKm < 0) {
      return { ok: false, error: "Odometer readings cannot be negative" };
    }
    if (trip.endOdometerKm < trip.startOdometerKm) {
      return {
        ok: false,
        error: `End odometer (${trip.endOdometerKm} km) cannot be less than start odometer (${trip.startOdometerKm} km). Correct the readings before completing.`,
      };
    }
  }

  // Must have at least one valid distance basis
  const hasRoute = trip.routeDistanceM !== null && trip.routeDistanceM > 0 && !trip.routeStale;
  const hasActual = trip.actualDistanceKm !== null && trip.actualDistanceKm > 0;
  const hasManual =
    trip.manualDistanceKm !== null &&
    trip.manualDistanceKm > 0 &&
    trip.distanceBasis === "MANUAL_OVERRIDE";

  if (!hasRoute && !hasActual && !hasManual) {
    return {
      ok: false,
      error:
        "Trip requires a valid distance basis: a persisted route estimate, actual odometer readings, or an authorized manual override.",
    };
  }

  // If route is stale and no alternative distance, reject
  if (trip.routeStale && !hasActual && !hasManual) {
    return {
      ok: false,
      error:
        "Route calculation is stale. Recalculate the route, or provide actual odometer readings or a manual distance.",
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Trip draft + quick trip (record-only fast path)
// ---------------------------------------------------------------------------

/**
 * Fields every trip save needs. The fast path and the full route flow share
 * this shape, so both persist exactly the same trip record.
 */
export interface TripDraftInput {
  vehicleId: string;
  driverUserId: string;
  tripDate: string;
  purpose: string;
  stops: TripStop[];
  assignmentId?: string;
  externalReference?: string;
  notes?: string;
}

export interface TripDraftErrors {
  vehicleId?: string;
  tripDate?: string;
  purpose?: string;
  origin?: string;
  destination?: string;
  stops?: string;
}

/** Body accepted by POST /api/v1/trips and PATCH /api/v1/trips/[id]. */
export interface TripDraftBody {
  vehicleId: string;
  driverUserId: string;
  assignmentId?: string;
  tripDate: string;
  purpose: string;
  externalReference?: string;
  notes?: string;
  stops: TripStop[];
}

export type TripDraftResult =
  { ok: true; draft: TripDraftBody } | { ok: false; errors: TripDraftErrors };

/**
 * Build the save body for a trip and report every missing fact at once, so a
 * form can point at the offending field instead of failing on the first one.
 */
export function buildTripDraft(input: TripDraftInput): TripDraftResult {
  const errors: TripDraftErrors = {};

  const vehicleId = input.vehicleId.trim();
  if (!vehicleId) errors.vehicleId = "Choose a vehicle.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.tripDate)) errors.tripDate = "Choose the trip date.";
  if (!(TRIP_PURPOSES as readonly string[]).includes(input.purpose)) {
    errors.purpose = "Choose a purpose.";
  }

  const ordered = input.stops.slice().sort((a, b) => a.sequence - b.sequence);
  const origin = ordered[0];
  const destination = ordered[ordered.length - 1];

  if (!origin || origin.type !== "ORIGIN") {
    errors.origin = "Add the place the trip started.";
  } else if (!origin.label.trim()) {
    errors.origin = "Where did the trip start?";
  }

  if (ordered.length < 2 || !destination || destination.type !== "DESTINATION") {
    errors.destination = "Add the place the trip ended.";
  } else if (!destination.label.trim()) {
    errors.destination = "Where did the trip end?";
  }

  if (ordered.some((s) => s.type === "INTERMEDIATE" && !s.label.trim())) {
    errors.stops = "Every stop on the route needs a name.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  // Sequence is normalised from the order the user arranged; types are kept
  // as the builder assigned them (the API validates the same invariants).
  const stops = ordered.map((stop, index) => ({
    ...stop,
    sequence: index,
    label: stop.label.trim(),
    address: stop.address?.trim() ? stop.address.trim() : null,
  }));

  return {
    ok: true,
    draft: {
      vehicleId,
      driverUserId: input.driverUserId,
      assignmentId: input.assignmentId || undefined,
      tripDate: input.tripDate,
      purpose: input.purpose,
      externalReference: input.externalReference?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      stops,
    },
  };
}

/** Parse a whole-kilometre odometer reading; null when absent or invalid. */
export function parseOdometerReading(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

export interface QuickTripPlan {
  ok: boolean;
  errors: TripDraftErrors & { odometers?: string };
  /** Odometer delta in whole kilometres for display — null when unusable. */
  distanceKm: number | null;
  draft: TripDraftBody | null;
  /** Body for POST /api/v1/trips/[id]/complete (actual-distance basis). */
  completion: { startOdometerKm: number; endOdometerKm: number } | null;
}

/**
 * Plan the fast path: the driver supplies where the trip went and the two
 * odometer readings; the pair gives the distance, so no routing provider is
 * needed. Both readings are required here — without them the trip belongs in
 * the route flow instead.
 */
export function planQuickTrip(
  input: TripDraftInput & { startOdometerKm: string; endOdometerKm: string },
): QuickTripPlan {
  const draftResult = buildTripDraft(input);
  const errors: QuickTripPlan["errors"] = draftResult.ok ? {} : { ...draftResult.errors };

  const start = parseOdometerReading(input.startOdometerKm);
  const end = parseOdometerReading(input.endOdometerKm);
  if (start === null) {
    errors.odometers = "Enter the start odometer in whole kilometres.";
  } else if (end === null) {
    errors.odometers = "Enter the end odometer in whole kilometres.";
  } else if (end <= start) {
    errors.odometers = `The end odometer must be higher than the start (${start} km) — the pair is what gives the trip its distance.`;
  }

  if (!draftResult.ok || Object.keys(errors).length > 0 || start === null || end === null) {
    return { ok: false, errors, distanceKm: null, draft: null, completion: null };
  }

  return {
    ok: true,
    errors: {},
    distanceKm: end - start,
    draft: draftResult.draft,
    completion: { startOdometerKm: start, endOdometerKm: end },
  };
}

// ---------------------------------------------------------------------------
// Idempotency key generation
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic idempotency key from trip data.
 * The key is a SHA-256 hash of the vehicle, driver, date, and stop IDs,
 * ensuring that the same logical trip always produces the same key.
 */
export function generateIdempotencyKey(
  vehicleId: string,
  driverUserId: string,
  tripDate: string,
  stops: TripStop[],
): string {
  const stopIds = stops
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((s) => s.id)
    .join("|");
  const payload = `${vehicleId}:${driverUserId}:${tripDate}:${stopIds}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------------------
// Stop ID generation
// ---------------------------------------------------------------------------

/**
 * Generate a unique stop ID. Uses a timestamp + random hex for uniqueness.
 */
export function generateStopId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `stop_${ts}_${rand}`;
}

// ---------------------------------------------------------------------------
// Route staleness
// ---------------------------------------------------------------------------

/**
 * Mark a trip's route as stale. Called when stops change after a route has
 * already been calculated.
 */
export function markRouteStale(trip: Trip): Trip {
  return {
    ...trip,
    routeStale: true,
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Actual distance computation
// ---------------------------------------------------------------------------

/**
 * Compute actual distance from odometer readings. Returns null when either
 * reading is missing or the end is below the start (anomalous).
 */
export function computeActualDistance(startKm: number | null, endKm: number | null): number | null {
  if (startKm === null || endKm === null) return null;
  if (typeof startKm !== "number" || typeof endKm !== "number") return null;
  if (endKm < startKm) return null;
  return endKm - startKm;
}

/**
 * Compute the single validated effective distance in metres for a trip.
 * This is the authoritative distance used for both the completed trip record
 * and the vehicle projection. It returns the distance in metres.
 *
 * Precedence:
 *  1. Actual odometer distance (when valid start/end readings exist)
 *  2. Manual override (when authorized with reason)
 *  3. Persisted route estimate (when not stale)
 */
export function computeEffectiveDistanceM(trip: {
  actualDistanceKm?: number | null;
  routeDistanceM?: number | null;
  routeStale?: boolean;
  manualDistanceKm?: number | null;
  distanceBasis?: string;
}): number | null {
  // 1. Actual measured distance
  if (
    trip.actualDistanceKm !== null &&
    trip.actualDistanceKm !== undefined &&
    trip.actualDistanceKm > 0
  ) {
    return Math.round(trip.actualDistanceKm * 1000);
  }
  // 2. Authorized manual override
  if (
    trip.distanceBasis === "MANUAL_OVERRIDE" &&
    trip.manualDistanceKm !== null &&
    trip.manualDistanceKm !== undefined &&
    trip.manualDistanceKm > 0
  ) {
    return Math.round(trip.manualDistanceKm * 1000);
  }
  // 3. Persisted route estimate (must not be stale)
  if (
    trip.routeDistanceM !== null &&
    trip.routeDistanceM !== undefined &&
    trip.routeDistanceM > 0 &&
    !trip.routeStale
  ) {
    return trip.routeDistanceM;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Derive origin and destination
// ---------------------------------------------------------------------------

/**
 * Derive origin and destination from the stops array. The origin is the stop
 * with the lowest sequence number of type ORIGIN; the destination is the
 * highest sequence number of type DESTINATION.
 */
export function deriveOriginDestination(stops: TripStop[]): {
  origin: TripStop;
  destination: TripStop;
} {
  const origin = stops.find((s) => s.type === "ORIGIN");
  const destination = stops.find((s) => s.type === "DESTINATION");

  if (!origin) {
    throw new Error("No ORIGIN stop found in stops array");
  }
  if (!destination) {
    throw new Error("No DESTINATION stop found in stops array");
  }

  return { origin, destination };
}

/**
 * Read-path resolver: derive origin/destination WITHOUT throwing.
 *
 * `deriveOriginDestination` is strict and is the right guard on the write
 * path (create/update), where a trip missing its ORIGIN/DESTINATION markers
 * is corrupt input we must reject. The read path is different: `toTrip` maps
 * every stored document, and one legacy or hand-edited row without the
 * markers used to throw and 500 an entire list page (e.g. /trips reads every
 * trip through this mapper). Documents predating the stop-`type` field carry
 * no markers at all, so a throw here punishes the whole collection for one
 * old row.
 *
 * Instead we fall back to positional semantics — first stop by sequence is
 * the origin, last is the destination — which matches how the markers are
 * assigned (index 0 = ORIGIN, last = DESTINATION) and keeps a malformed row
 * rendering (with a possibly imprecise origin/destination) rather than
 * crashing the page.
 */
export function resolveOriginDestination(stops: TripStop[]): {
  origin: TripStop;
  destination: TripStop;
} {
  const byTypeOrigin = stops.find((s) => s.type === "ORIGIN");
  const byTypeDestination = stops.find((s) => s.type === "DESTINATION");

  if (byTypeOrigin && byTypeDestination) {
    return { origin: byTypeOrigin, destination: byTypeDestination };
  }

  // Fall back to positional first/last (sorted by sequence) when markers are
  // missing. Guard the empty/degenerate case so we never index undefined.
  const sorted = [...stops].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const empty = {} as TripStop;
  return {
    origin: byTypeOrigin ?? first ?? empty,
    destination: byTypeDestination ?? last ?? empty,
  };
}

// ---------------------------------------------------------------------------
// Estimated projection
// ---------------------------------------------------------------------------

export interface ProjectionResult {
  estimatedKm: number;
  tripCount: number;
  totalRouteM: number;
}

/**
 * Compute the estimated projected odometer from a verified baseline and
 * completed trips.
 *
 * Formula:
 *  - Filter COMPLETED trips whose completedAt > verifiedBaselineAt
 *  - Sum their distance using getTripDistanceMetres (best available)
 *  - estimatedKm = verifiedBaselineKm + (sumMetres / 1000)
 */
export function computeEstimatedProjection(
  verifiedBaselineKm: number,
  verifiedBaselineAt: string,
  completedTrips: Trip[],
): ProjectionResult {
  // Use tripDate (the actual journey date) for projection eligibility,
  // NOT completedAt (when the record was entered) or startedAt (draft creation).
  // A trip recorded Oct 12 for a journey on Oct 8 must NOT be projected if the
  // baseline is Oct 10 — the Oct 10 verified reading already includes that journey.
  //
  // Policy: trips with tripDate strictly AFTER the baseline date are eligible.
  // Trips on the same date as the baseline are EXCLUDED (the verified reading
  // is assumed to include all journeys up to and including that date).
  const baselineDateStr = verifiedBaselineAt.slice(0, 10); // YYYY-MM-DD
  const eligible = completedTrips.filter((t) => {
    if (t.status !== "COMPLETED") return false;
    if (!t.tripDate) return false;
    // Compare date strings (YYYY-MM-DD format is lexicographically ordered)
    return t.tripDate > baselineDateStr;
  });

  let totalRouteM = 0;
  for (const trip of eligible) {
    // Follow the trip's actual distance basis and data availability:
    // 1. Prefer ACTUAL_ODOMETER when valid start/end readings exist
    // 2. Use MANUAL_OVERRIDE when explicitly authorized
    // 3. Use route estimate as a fallback
    const distM = getTripDistanceMetres(trip);
    if (distM !== null) {
      totalRouteM += distM;
    }
  }

  const estimatedKm = verifiedBaselineKm + totalRouteM / 1000;

  return {
    estimatedKm: Math.round(estimatedKm * 100) / 100,
    tripCount: eligible.length,
    totalRouteM,
  };
}

/**
 * Extract the best available distance for a trip in metres.
 * Follows the trip's declared distance basis and available data.
 */
export function getTripDistanceMetres(trip: Trip): number | null {
  // Prefer actual measured distance when readings exist
  if (trip.actualDistanceKm !== null && trip.actualDistanceKm > 0) {
    return Math.round(trip.actualDistanceKm * 1000);
  }
  // Use manual override when explicitly authorized
  if (
    trip.distanceBasis === "MANUAL_OVERRIDE" &&
    trip.manualDistanceKm !== null &&
    trip.manualDistanceKm > 0
  ) {
    return Math.round(trip.manualDistanceKm * 1000);
  }
  // Fall back to route estimate
  if (trip.routeDistanceM !== null && trip.routeDistanceM > 0) {
    return trip.routeDistanceM;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Odometer reconciliation flagging
// ---------------------------------------------------------------------------

/** Threshold for flagging a route-vs-actual discrepancy (percentage). */
export const RECONCILIATION_THRESHOLD_PCT = 20;
/** Minimum distance (metres) below which discrepancies are not flagged. */
export const RECONCILIATION_MIN_DISTANCE_M = 500;

export interface ReconciliationFlag {
  tripId: string;
  routeDistanceM: number | null;
  actualDistanceKm: number | null;
  actualDistanceM: number | null;
  discrepancyM: number | null;
  discrepancyPct: number | null;
  severity: "OK" | "FLAGGED";
  note: string | null;
}

/**
 * Check whether a completed trip's route estimate diverges significantly
 * from its actual odometer distance. Used to surface data-quality warnings
 * on vehicle profiles and the operations register.
 *
 * A trip is flagged when:
 *   - Both route estimate and actual odometer distance exist, AND
 *   - The actual distance exceeds RECONCILIATION_MIN_DISTANCE_M, AND
 *   - The absolute discrepancy exceeds RECONCILIATION_THRESHOLD_PCT%.
 */
export function checkReconciliation(trip: Trip): ReconciliationFlag {
  const routeM = trip.routeDistanceM ?? null;
  const actualKm = trip.actualDistanceKm ?? null;
  const actualM = actualKm !== null ? Math.round(actualKm * 1000) : null;

  if (routeM === null || actualM === null) {
    return {
      tripId: trip.id,
      routeDistanceM: routeM,
      actualDistanceKm: actualKm,
      actualDistanceM: actualM,
      discrepancyM: null,
      discrepancyPct: null,
      severity: "OK",
      note: actualM === null ? "No actual odometer reading" : "No route estimate",
    };
  }

  const discrepancyM = Math.abs(routeM - actualM);
  const discrepancyPct = actualM > 0 ? (discrepancyM / actualM) * 100 : 0;

  if (actualM < RECONCILIATION_MIN_DISTANCE_M) {
    return {
      tripId: trip.id,
      routeDistanceM: routeM,
      actualDistanceKm: actualKm,
      actualDistanceM: actualM,
      discrepancyM,
      discrepancyPct: Math.round(discrepancyPct * 10) / 10,
      severity: "OK",
      note: "Short trip — discrepancy not flagged",
    };
  }

  const flagged = discrepancyPct > RECONCILIATION_THRESHOLD_PCT;
  return {
    tripId: trip.id,
    routeDistanceM: routeM,
    actualDistanceKm: actualKm,
    actualDistanceM: actualM,
    discrepancyM,
    discrepancyPct: Math.round(discrepancyPct * 10) / 10,
    severity: flagged ? "FLAGGED" : "OK",
    note: flagged
      ? `Route estimate differs from actual by ${Math.round(discrepancyPct)}% (${Math.round(discrepancyM / 100) / 10} km)`
      : null,
  };
}

/**
 * Batch reconciliation check for a list of completed trips.
 * Returns only the flagged trips for efficient display.
 */
export function findReconciliationFlags(trips: Trip[]): ReconciliationFlag[] {
  return trips
    .filter((t) => t.status === "COMPLETED")
    .map(checkReconciliation)
    .filter((flag) => flag.severity === "FLAGGED");
}
