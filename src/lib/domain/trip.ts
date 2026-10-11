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
  return { ok: true };
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
  const baselineTime = new Date(verifiedBaselineAt).getTime();

  const eligible = completedTrips.filter(
    (t) =>
      t.status === "COMPLETED" && t.completedAt && new Date(t.completedAt).getTime() > baselineTime,
  );

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
