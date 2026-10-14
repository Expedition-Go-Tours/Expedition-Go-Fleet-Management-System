import type { DocumentData } from "firebase-admin/firestore";

import type {
  DistanceBasis,
  RouteLeg,
  Trip,
  TripPurpose,
  TripStatus,
  TripStop,
} from "@/lib/domain/trip";
import {
  computeActualDistance,
  computeEffectiveDistanceM,
  computeEstimatedProjection,
  deriveOriginDestination,
  generateIdempotencyKey,
  getTripDistanceMetres,
  resolveOriginDestination,
  validateTripCompletion,
  validateTripForSave,
} from "@/lib/domain/trip";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import { AUDIT_EVENTS, writeAuditEventInTx } from "@/lib/repos/audit";
import { toDate } from "@/lib/repos/timestamps";
import type { RouteResult } from "@/lib/routing/provider";

/*
 * Trip repository.
 *
 * State-changing operations use Firestore transactions to keep trip status,
 * vehicle projections, and audit events consistent. Retries are safe:
 * idempotency keys ensure the same logical trip-completion produces the same
 * result.
 */

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class TripError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TripError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tripsRef() {
  return getAdminDb().collection(COLLECTIONS.trips);
}

function toIsoString(value: unknown): string | null {
  if (!value) return null;
  const d = toDate(value);
  return d ? d.toISOString() : null;
}

function toTrip(id: string, data: DocumentData): Trip & { routeGeometry?: unknown } {
  const stops = (data.stops ?? []) as TripStop[];
  // Read path: use the NON-throwing resolver. A legacy or hand-edited
  // document whose stops predate the `type` field (or lost their ORIGIN /
  // DESTINATION markers) must not throw here — this mapper runs over every
  // row in list/aggregate queries, so one bad document used to 500 an entire
  // page (e.g. /trips). We degrade to positional first/last instead. The
  // strict `deriveOriginDestination` still guards the write path.
  const { origin, destination } =
    stops.length >= 2
      ? resolveOriginDestination(stops)
      : {
          origin: data.origin ?? stops[0] ?? ({} as TripStop),
          destination: data.destination ?? stops[stops.length - 1] ?? ({} as TripStop),
        };

  return {
    id,
    vehicleId: String(data.vehicleId ?? ""),
    driverUserId: String(data.driverUserId ?? ""),
    assignmentId: data.assignmentId ? String(data.assignmentId) : null,
    recordedByUserId: String(data.recordedByUserId ?? ""),
    tripDate: String(data.tripDate ?? ""),
    purpose: (data.purpose ?? "OTHER") as TripPurpose,
    externalReference: data.externalReference ? String(data.externalReference) : null,
    notes: data.notes ? String(data.notes) : null,
    status: (data.status ?? "DRAFT") as TripStatus,

    origin,
    destination,
    stops,

    routeDistanceM: typeof data.routeDistanceM === "number" ? data.routeDistanceM : null,
    routeDistanceKm: typeof data.routeDistanceKm === "number" ? data.routeDistanceKm : null,
    routeDurationS: typeof data.routeDurationS === "number" ? data.routeDurationS : null,
    routingProvider: data.routingProvider ? String(data.routingProvider) : null,
    routeCalculatedAt: toIsoString(data.routeCalculatedAt),
    routeProviderMeta: data.routeProviderMeta ?? null,
    routeLegs: (data.routeLegs ?? []) as RouteLeg[],

    startOdometerKm: typeof data.startOdometerKm === "number" ? data.startOdometerKm : null,
    endOdometerKm: typeof data.endOdometerKm === "number" ? data.endOdometerKm : null,
    actualDistanceKm: typeof data.actualDistanceKm === "number" ? data.actualDistanceKm : null,

    distanceBasis: (data.distanceBasis ?? "ROUTE_ESTIMATE") as DistanceBasis,
    manualDistanceKm: typeof data.manualDistanceKm === "number" ? data.manualDistanceKm : null,
    manualDistanceReason: data.manualDistanceReason ? String(data.manualDistanceReason) : null,

    routeStale: Boolean(data.routeStale),
    routeGeometry: data.routeGeometry ?? null,

    startedAt: toIsoString(data.startedAt),
    completedAt: toIsoString(data.completedAt),
    idempotencyKey: String(data.idempotencyKey ?? ""),
    createdAt: toIsoString(data.createdAt) ?? new Date(0).toISOString(),
    updatedAt: toIsoString(data.updatedAt) ?? new Date(0).toISOString(),
    createdBy: String(data.createdBy ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateTripInput {
  vehicleId: string;
  driverUserId: string;
  assignmentId?: string;
  recordedByUserId: string;
  tripDate: string;
  purpose: TripPurpose;
  externalReference?: string;
  notes?: string;
  stops: TripStop[];
  manualDistanceKm?: number;
  manualDistanceReason?: string;
  idempotencyToken?: string;
}

export interface UpdateTripInput {
  tripDate?: string;
  purpose?: TripPurpose;
  externalReference?: string;
  notes?: string;
  stops?: TripStop[];
  manualDistanceKm?: number;
  manualDistanceReason?: string;
  distanceBasis?: DistanceBasis;
  startOdometerKm?: number;
  endOdometerKm?: number;
  assignmentId?: string;
}

export interface CompleteTripInput {
  actorId: string;
  startOdometerKm?: number;
  endOdometerKm?: number;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createTrip(input: CreateTripInput): Promise<Trip> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const ref = input.idempotencyToken ? tripsRef().doc(input.idempotencyToken) : tripsRef().doc();

  // Idempotency: if a document with this ID already exists, return it
  if (input.idempotencyToken) {
    const existing = await ref.get();
    if (existing.exists) {
      return toTrip(existing.id, existing.data() ?? {});
    }
  }

  const { origin, destination } = deriveOriginDestination(input.stops);
  const idempotencyKey = generateIdempotencyKey(
    input.vehicleId,
    input.driverUserId,
    input.tripDate,
    input.stops,
  );

  const partialTrip: Partial<Trip> = {
    vehicleId: input.vehicleId,
    driverUserId: input.driverUserId,
    tripDate: input.tripDate,
    purpose: input.purpose,
    stops: input.stops,
    distanceBasis: input.manualDistanceKm ? "MANUAL_OVERRIDE" : "ROUTE_ESTIMATE",
    manualDistanceKm: input.manualDistanceKm ?? null,
    manualDistanceReason: input.manualDistanceReason ?? null,
  };
  const validation = validateTripForSave(partialTrip);
  if (!validation.ok) {
    throw new TripError("VALIDATION_FAILED", validation.error);
  }

  const now = FieldValue.serverTimestamp();
  const nowIso = new Date().toISOString();

  const db = getAdminDb();
  await db.runTransaction(async (tx) => {
    tx.set(ref, {
      vehicleId: input.vehicleId,
      driverUserId: input.driverUserId,
      assignmentId: input.assignmentId ?? null,
      recordedByUserId: input.recordedByUserId,
      tripDate: input.tripDate,
      purpose: input.purpose,
      externalReference: input.externalReference ?? null,
      notes: input.notes ?? null,
      status: "DRAFT",

      origin,
      destination,
      stops: input.stops,

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

      distanceBasis: input.manualDistanceKm ? "MANUAL_OVERRIDE" : "ROUTE_ESTIMATE",
      manualDistanceKm: input.manualDistanceKm ?? null,
      manualDistanceReason: input.manualDistanceReason ?? null,

      routeStale: false,

      startedAt: now,
      completedAt: null,
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
      createdBy: input.recordedByUserId,
    });

    writeAuditEventInTx(tx, {
      eventType: AUDIT_EVENTS.TRIP_CREATED,
      actorId: input.recordedByUserId,
      entityType: "trip",
      entityId: ref.id,
      after: { vehicleId: input.vehicleId, purpose: input.purpose },
    });
  });

  // Return the trip with approximate timestamps (server-side will be slightly
  // different, but the domain model is functionally correct).
  return {
    id: ref.id,
    vehicleId: input.vehicleId,
    driverUserId: input.driverUserId,
    assignmentId: input.assignmentId ?? null,
    recordedByUserId: input.recordedByUserId,
    tripDate: input.tripDate,
    purpose: input.purpose,
    externalReference: input.externalReference ?? null,
    notes: input.notes ?? null,
    status: "DRAFT",
    origin,
    destination,
    stops: input.stops,
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
    distanceBasis: input.manualDistanceKm ? "MANUAL_OVERRIDE" : "ROUTE_ESTIMATE",
    manualDistanceKm: input.manualDistanceKm ?? null,
    manualDistanceReason: input.manualDistanceReason ?? null,
    routeStale: false,
    startedAt: nowIso,
    completedAt: null,
    idempotencyKey,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: input.recordedByUserId,
  };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateTrip(
  id: string,
  input: UpdateTripInput,
  actorId: string,
): Promise<Trip> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const db = getAdminDb();
  const ref = tripsRef().doc(id);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new TripError("NOT_FOUND", "Trip not found");
    const existing = toTrip(snap.id, snap.data() ?? {});
    if (existing.status !== "DRAFT") {
      throw new TripError("INVALID_STATUS", `Cannot edit a trip with status ${existing.status}`);
    }

    const updatedStops = input.stops ?? existing.stops;
    const stopsChanged =
      input.stops !== undefined && JSON.stringify(input.stops) !== JSON.stringify(existing.stops);

    const merged: Partial<Trip> = {
      ...existing,
      ...input,
      stops: updatedStops,
    };
    const validation = validateTripForSave(merged);
    if (!validation.ok) {
      throw new TripError("VALIDATION_FAILED", validation.error);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (input.tripDate !== undefined) updateData.tripDate = input.tripDate;
    if (input.purpose !== undefined) updateData.purpose = input.purpose;
    if (input.externalReference !== undefined)
      updateData.externalReference = input.externalReference ?? null;
    if (input.notes !== undefined) updateData.notes = input.notes ?? null;
    if (input.assignmentId !== undefined) updateData.assignmentId = input.assignmentId ?? null;
    if (input.startOdometerKm !== undefined) updateData.startOdometerKm = input.startOdometerKm;
    if (input.endOdometerKm !== undefined) updateData.endOdometerKm = input.endOdometerKm;
    if (input.manualDistanceKm !== undefined) updateData.manualDistanceKm = input.manualDistanceKm;
    if (input.manualDistanceReason !== undefined)
      updateData.manualDistanceReason = input.manualDistanceReason;
    if (input.distanceBasis !== undefined) updateData.distanceBasis = input.distanceBasis;

    if (input.stops !== undefined) {
      const { origin, destination } = deriveOriginDestination(updatedStops);
      updateData.stops = updatedStops;
      updateData.origin = origin;
      updateData.destination = destination;
      if (stopsChanged && existing.routeDistanceM !== null) {
        updateData.routeStale = true;
      }
    }

    tx.update(ref, updateData);

    writeAuditEventInTx(tx, {
      eventType: AUDIT_EVENTS.TRIP_UPDATED,
      actorId,
      entityType: "trip",
      entityId: id,
      before: { status: existing.status },
      after: updateData,
    });

    // Build the return value from the original snapshot + applied changes.
    // Firestore requires all reads BEFORE writes in a transaction.
    return toTrip(id, { ...existing, ...updateData });
  });
}

// ---------------------------------------------------------------------------
// Complete
// ---------------------------------------------------------------------------

export async function completeTrip(
  id: string,
  input: CompleteTripInput,
): Promise<{ trip: Trip; projectionUpdated: boolean }> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const db = getAdminDb();
  const ref = tripsRef().doc(id);

  return db.runTransaction(async (tx) => {
    // ── All reads first (Firestore transaction rule) ─────────────
    const snap = await tx.get(ref);
    if (!snap.exists) throw new TripError("NOT_FOUND", "Trip not found");
    const trip = toTrip(snap.id, snap.data() ?? {});

    // Idempotency: if already completed, return as-is
    if (trip.status === "COMPLETED") {
      return { trip, projectionUpdated: false };
    }

    // Merge completion inputs and recompute actualDistanceKm before validation.
    // This ensures the validator sees the odometer delta from the request,
    // not the stale actualDistanceKm from the stored draft.
    const startOdoForValidation = input.startOdometerKm ?? trip.startOdometerKm;
    const endOdoForValidation = input.endOdometerKm ?? trip.endOdometerKm;

    // Validate each supplied odometer reading independently.
    if (startOdoForValidation !== null && startOdoForValidation < 0) {
      throw new TripError("VALIDATION_FAILED", "Start odometer reading cannot be negative");
    }
    if (endOdoForValidation !== null && endOdoForValidation < 0) {
      throw new TripError("VALIDATION_FAILED", "End odometer reading cannot be negative");
    }

    // If both readings are supplied, they must form a valid pair.
    if (startOdoForValidation !== null && endOdoForValidation !== null) {
      if (endOdoForValidation < startOdoForValidation) {
        throw new TripError(
          "VALIDATION_FAILED",
          `End odometer (${endOdoForValidation} km) cannot be less than start odometer (${startOdoForValidation} km). Correct the readings before completing.`,
        );
      }
    }

    // If only one reading is supplied, require the other for actual-distance basis.
    if (
      (startOdoForValidation !== null && endOdoForValidation === null) ||
      (startOdoForValidation === null && endOdoForValidation !== null)
    ) {
      throw new TripError(
        "VALIDATION_FAILED",
        "Both start and end odometer readings are required for actual-distance completion. Provide both readings or use a route estimate.",
      );
    }

    const recomputedActualKm = computeActualDistance(startOdoForValidation, endOdoForValidation);
    const tripForValidation: Trip = {
      ...trip,
      startOdometerKm: startOdoForValidation,
      endOdometerKm: endOdoForValidation,
      actualDistanceKm: recomputedActualKm,
    };
    const validation = validateTripCompletion(tripForValidation);
    if (!validation.ok) {
      throw new TripError("VALIDATION_FAILED", validation.error);
    }

    // Read the vehicle document BEFORE any writes (Firestore rule).
    const vehicleRef = db.collection(COLLECTIONS.vehicles).doc(trip.vehicleId);
    const vehicleSnap = await tx.get(vehicleRef);
    if (!vehicleSnap.exists) {
      throw new TripError("VEHICLE_NOT_FOUND", `Vehicle ${trip.vehicleId} not found`);
    }
    const vehicle = vehicleSnap.data() ?? {};

    // ── All writes below ─────────────────────────────────────────

    const startOdo = input.startOdometerKm ?? trip.startOdometerKm;
    const endOdo = input.endOdometerKm ?? trip.endOdometerKm;
    const actualDistanceKm = computeActualDistance(startOdo, endOdo);

    // Compute the ONE validated effective distance (in metres) from the
    // trip's authoritative data. This same value is used for both the
    // completed trip record and the vehicle projection.
    const effectiveDistanceM = computeEffectiveDistanceM({
      actualDistanceKm,
      routeDistanceM: trip.routeDistanceM,
      routeStale: trip.routeStale,
      manualDistanceKm: trip.manualDistanceKm,
      distanceBasis: trip.distanceBasis,
    });

    if (effectiveDistanceM === null) {
      throw new TripError(
        "VALIDATION_FAILED",
        "Trip requires a valid distance basis: a persisted route estimate, actual odometer readings, or an authorized manual override.",
      );
    }

    // Determine the distance basis that MATCHES the effective distance used.
    // Zero-distance readings (start == end) are not a valid basis on their own.
    let distanceBasis: DistanceBasis;
    if (actualDistanceKm !== null && actualDistanceKm > 0) {
      distanceBasis = "ACTUAL_ODOMETER";
    } else if (
      trip.manualDistanceKm !== null &&
      trip.manualDistanceKm > 0 &&
      trip.distanceBasis === "MANUAL_OVERRIDE"
    ) {
      distanceBasis = "MANUAL_OVERRIDE";
    } else if (trip.routeDistanceM !== null && trip.routeDistanceM > 0 && !trip.routeStale) {
      distanceBasis = "ROUTE_ESTIMATE";
    } else {
      throw new TripError(
        "VALIDATION_FAILED",
        "Cannot determine a valid distance basis. Check odometer readings, manual override, or route calculation.",
      );
    }

    const now = FieldValue.serverTimestamp();
    const completedAtIso = new Date().toISOString();

    // Write trip completion
    tx.update(ref, {
      status: "COMPLETED",
      completedAt: now,
      startOdometerKm: startOdo ?? null,
      endOdometerKm: endOdo ?? null,
      actualDistanceKm,
      distanceBasis,
      notes: input.notes ? input.notes.slice(0, 1000) : (trip.notes ?? null),
      updatedAt: now,
    });

    // Project the vehicle's estimated km using the SAME validated distance.
    // Projection updates are MANDATORY: if this fails, the entire transaction
    // fails so trip and vehicle state remain consistent. No silent swallowing.
    let projectionUpdated = false;
    {
      const odometerKm = Number(vehicle.odometerKm ?? 0);
      const odometerAt = vehicle.odometerAt;
      const baselineAt = odometerAt
        ? (toDate(odometerAt)?.toISOString() ?? new Date(0).toISOString())
        : new Date(0).toISOString();

      // Use tripDate (the actual journey date) for projection eligibility,
      // NOT completedAt or startedAt (record creation time).
      // Policy: trips with tripDate strictly AFTER the baseline date are eligible.
      // Same-date trips are excluded (the verified reading includes them).
      const baselineDateStr = baselineAt.slice(0, 10); // YYYY-MM-DD
      const eligible = trip.tripDate > baselineDateStr;
      const addMetres = eligible ? effectiveDistanceM : 0;

      if (addMetres > 0) {
        const currentEstimateKm =
          typeof vehicle.estimatedKm === "number" ? vehicle.estimatedKm : odometerKm;
        const currentTripCount =
          typeof vehicle.estimatedKmTripCount === "number" ? vehicle.estimatedKmTripCount : 0;
        const newEstimateKm = Math.round((currentEstimateKm + addMetres / 1000) * 100) / 100;

        tx.update(vehicleRef, {
          estimatedKm: newEstimateKm,
          estimatedKmUpdatedAt: completedAtIso,
          estimatedKmTripCount: currentTripCount + 1,
          updatedAt: FieldValue.serverTimestamp(),
        });
        projectionUpdated = true;
      }
    }

    // Write audit event atomically with the business changes.
    writeAuditEventInTx(tx, {
      eventType: AUDIT_EVENTS.TRIP_COMPLETED,
      actorId: input.actorId,
      entityType: "trip",
      entityId: id,
      after: { status: "COMPLETED", distanceBasis, actualDistanceKm },
    });

    const completedTrip: Trip = {
      ...trip,
      status: "COMPLETED",
      completedAt: completedAtIso,
      startOdometerKm: startOdo ?? null,
      endOdometerKm: endOdo ?? null,
      actualDistanceKm,
      distanceBasis,
      notes: input.notes ? input.notes.slice(0, 1000) : (trip.notes ?? null),
      updatedAt: completedAtIso,
    };

    return { trip: completedTrip, projectionUpdated };
  });
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export async function cancelTrip(id: string, actorId: string, reason?: string): Promise<Trip> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const db = getAdminDb();
  const ref = tripsRef().doc(id);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new TripError("NOT_FOUND", "Trip not found");
    const trip = toTrip(snap.id, snap.data() ?? {});
    if (trip.status !== "DRAFT") {
      throw new TripError("INVALID_STATUS", `Cannot cancel a trip with status ${trip.status}`);
    }

    tx.update(ref, {
      status: "CANCELLED",
      notes: reason ? reason.slice(0, 1000) : (trip.notes ?? null),
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditEventInTx(tx, {
      eventType: AUDIT_EVENTS.TRIP_CANCELLED,
      actorId,
      entityType: "trip",
      entityId: id,
      reason,
    });

    // Build return value from original snapshot + changes (reads must precede writes).
    return toTrip(id, {
      ...(snap.data() ?? {}),
      status: "CANCELLED",
      notes: reason ? reason.slice(0, 1000) : (trip.notes ?? null),
    });
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * List trips with optional filters. When no filters are provided, returns
 * the most recent trips. Filters are applied in the order: vehicleId,
 * driverUserId, tripDate, status. Firestore compound index constraints
 * mean we apply at most one equality filter in the query and post-filter
 * the rest in memory (the collection is bounded at 500).
 */
export async function listTrips(options?: {
  vehicleId?: string;
  driverUserId?: string;
  tripDate?: string;
  status?: TripStatus;
  limit?: number;
}): Promise<Trip[]> {
  const limit = Math.min(options?.limit ?? 100, 500);
  let query: import("firebase-admin/firestore").Query = tripsRef();

  // Apply the most selective equality filter at the query level.
  if (options?.vehicleId) {
    query = query.where("vehicleId", "==", options.vehicleId);
  } else if (options?.driverUserId) {
    query = query.where("driverUserId", "==", options.driverUserId);
  } else if (options?.tripDate) {
    query = query.where("tripDate", "==", options.tripDate);
  } else if (options?.status) {
    query = query.where("status", "==", options.status);
  }

  const snap = await query.limit(500).get();
  let trips = snap.docs.map((d) => toTrip(d.id, d.data()));

  // Post-filter remaining criteria in memory.
  if (options?.vehicleId) {
    // Already filtered by vehicleId in query.
    if (options.driverUserId) trips = trips.filter((t) => t.driverUserId === options.driverUserId);
    if (options.tripDate) trips = trips.filter((t) => t.tripDate === options.tripDate);
    if (options.status) trips = trips.filter((t) => t.status === options.status);
  } else if (options?.driverUserId) {
    if (options.tripDate) trips = trips.filter((t) => t.tripDate === options.tripDate);
    if (options.status) trips = trips.filter((t) => t.status === options.status);
  } else if (options?.tripDate) {
    if (options.status) trips = trips.filter((t) => t.status === options.status);
  }

  return trips
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

export async function getTripById(id: string): Promise<Trip | null> {
  const snap = await tripsRef().doc(id).get();
  if (!snap.exists) return null;
  return toTrip(snap.id, snap.data() ?? {});
}

export async function listTripsForVehicle(
  vehicleId: string,
  options?: { status?: TripStatus; limit?: number },
): Promise<Trip[]> {
  let query: import("firebase-admin/firestore").Query = tripsRef().where(
    "vehicleId",
    "==",
    vehicleId,
  );
  if (options?.status) query = query.where("status", "==", options.status);
  const snap = await query.limit(2000).get();
  return snap.docs
    .map((d) => toTrip(d.id, d.data()))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, options?.limit ?? 100);
}

/**
 * Get aggregate metrics across ALL trips matching the filters (not just one page).
 * Used for the trip register summary cards.
 */
export async function getTripAggregateMetrics(options?: {
  vehicleId?: string;
  driverUserId?: string;
  status?: TripStatus;
  tripDate?: string;
  purpose?: string;
}): Promise<{
  totalCount: number;
  completedCount: number;
  draftCount: number;
  totalDistanceM: number;
  staleRouteCount: number;
  missingDistanceCount: number;
}> {
  let query: import("firebase-admin/firestore").Query = tripsRef();
  if (options?.vehicleId) query = query.where("vehicleId", "==", options.vehicleId);
  if (options?.driverUserId) query = query.where("driverUserId", "==", options.driverUserId);
  if (options?.status) query = query.where("status", "==", options.status);
  if (options?.tripDate) query = query.where("tripDate", "==", options.tripDate);
  if (options?.purpose) query = query.where("purpose", "==", options.purpose);

  const snap = await query.get();
  const trips = snap.docs.map((d) => toTrip(d.id, d.data()));

  let totalDistanceM = 0;
  let staleRouteCount = 0;
  let missingDistanceCount = 0;
  let completedCount = 0;
  let draftCount = 0;

  for (const t of trips) {
    if (t.status === "COMPLETED") {
      completedCount++;
      const distM = getTripDistanceMetres(t);
      if (distM !== null) {
        totalDistanceM += distM;
      } else {
        missingDistanceCount++;
      }
    } else if (t.status === "DRAFT") {
      draftCount++;
    }
    if (t.routeStale) staleRouteCount++;
  }

  return {
    totalCount: trips.length,
    completedCount,
    draftCount,
    totalDistanceM,
    staleRouteCount,
    missingDistanceCount,
  };
}

/**
 * List trips with proper server-side pagination and accurate totals.
 * Uses Firestore offset/limit for pagination and count() for totals.
 */
export async function listTripsPaginated(options?: {
  vehicleId?: string;
  driverUserId?: string;
  status?: TripStatus;
  tripDate?: string;
  purpose?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ trips: Trip[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const page = Math.max(1, options?.page ?? 1);
  const pageSize = Math.min(Math.max(1, options?.pageSize ?? 25), 100);

  // Build base query with server-side filters
  let query = tripsRef().orderBy("tripDate", "desc").orderBy("createdAt", "desc");

  if (options?.vehicleId) query = query.where("vehicleId", "==", options.vehicleId);
  if (options?.driverUserId) query = query.where("driverUserId", "==", options.driverUserId);
  if (options?.status) query = query.where("status", "==", options.status);
  if (options?.tripDate) query = query.where("tripDate", "==", options.tripDate);
  if (options?.purpose) query = query.where("purpose", "==", options.purpose);

  // For text search, we need to fetch and filter in memory (Firestore lacks
  // full-text search). But we fetch ALL matching records, not just one page.
  if (options?.search) {
    const searchLower = options.search.toLowerCase();
    const allSnap = await query.get();
    const allTrips = allSnap.docs
      .map((d) => toTrip(d.id, d.data()))
      .filter(
        (t) =>
          t.origin.label.toLowerCase().includes(searchLower) ||
          t.destination.label.toLowerCase().includes(searchLower) ||
          (t.externalReference ?? "").toLowerCase().includes(searchLower) ||
          (t.notes ?? "").toLowerCase().includes(searchLower),
      );
    const total = allTrips.length;
    const offset = (page - 1) * pageSize;
    const trips = allTrips.slice(offset, offset + pageSize);
    return {
      trips,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  // Get total count for the filtered query
  const countSnap = await query.count().get();
  const total = countSnap.data().count;

  // Get paginated results using offset
  const offset = (page - 1) * pageSize;
  const snap = await query.offset(offset).limit(pageSize).get();
  const trips = snap.docs.map((d) => toTrip(d.id, d.data()));

  return {
    trips,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function listTripsForDriverDate(
  driverUserId: string,
  tripDate: string,
): Promise<Trip[]> {
  const snap = await tripsRef()
    .where("driverUserId", "==", driverUserId)
    .where("tripDate", "==", tripDate)
    .limit(500)
    .get();
  return snap.docs
    .map((d) => toTrip(d.id, d.data()))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function listTripsForAssignment(assignmentId: string): Promise<Trip[]> {
  const snap = await tripsRef().where("assignmentId", "==", assignmentId).limit(500).get();
  return snap.docs
    .map((d) => toTrip(d.id, d.data()))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

// ---------------------------------------------------------------------------
// Route calculation
// ---------------------------------------------------------------------------

/**
 * Atomically save a route calculation to a trip.
 * Re-reads the trip in a transaction, verifies it is still editable and the
 * stop fingerprint hasn't changed, then writes the route fields.
 */
export async function saveRouteCalculation(
  tripId: string,
  route: RouteResult,
  legs: RouteLeg[],
  expectedFingerprint?: string,
): Promise<Trip> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const db = getAdminDb();
  const ref = tripsRef().doc(tripId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new TripError("NOT_FOUND", "Trip not found");
    const trip = toTrip(snap.id, snap.data() ?? {});

    if (trip.status !== "DRAFT") {
      throw new TripError("INVALID_STATUS", `Cannot save route to a ${trip.status} trip`);
    }

    // Verify stop fingerprint hasn't changed since the route was calculated.
    if (expectedFingerprint) {
      const currentFingerprint = trip.stops
        .sort((a, b) => a.sequence - b.sequence)
        .map((s) => `${s.id}:${s.sequence}:${s.latitude}:${s.longitude}`)
        .join("|");
      if (currentFingerprint !== expectedFingerprint) {
        throw new TripError(
          "VALIDATION_FAILED",
          "Stop coordinates or order changed during route calculation \u2014 please recalculate",
        );
      }
    }

    tx.update(ref, {
      routeDistanceM: route.totalDistanceM,
      routeDistanceKm: Math.round((route.totalDistanceM / 1000) * 100) / 100,
      routeDurationS: route.totalDurationS,
      routingProvider: route.provider,
      routeCalculatedAt: route.calculatedAt,
      routeProviderMeta: route.providerMeta ?? null,
      routeLegs: legs,
      routeGeometry: route.geometry ?? null,
      routeStale: false,
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditEventInTx(tx, {
      eventType: AUDIT_EVENTS.TRIP_ROUTE_CALCULATED,
      entityType: "trip",
      entityId: tripId,
      after: {
        provider: route.provider,
        distanceM: route.totalDistanceM,
        durationS: route.totalDurationS,
        legs: legs.length,
      },
    });

    return trip;
  });
}

// ---------------------------------------------------------------------------
// Reconcile vehicle estimated km
// ---------------------------------------------------------------------------

/**
 * Recompute a vehicle's estimated km from its verified odometer baseline and
 * all completed trips since that baseline.
 */
export async function reconcileVehicleEstimatedKm(
  vehicleId: string,
): Promise<{ estimatedKm: number; tripCount: number }> {
  const db = getAdminDb();
  return db.runTransaction(async (tx) => {
    return reconcileVehicleEstimatedKmInTx(tx, vehicleId);
  });
}

/**
 * Internal implementation that runs within an existing transaction.
 * When justCompletedMetres is provided, it increments the vehicle's estimated km
 * by that amount rather than re-querying all trips.
 */
async function reconcileVehicleEstimatedKmInTx(
  tx: import("firebase-admin/firestore").Transaction,
  vehicleId: string,
  justCompletedMetres?: number,
): Promise<{ estimatedKm: number; tripCount: number }> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const db = getAdminDb();
  const vehicleRef = db.collection(COLLECTIONS.vehicles).doc(vehicleId);
  const vehicleSnap = await tx.get(vehicleRef);
  if (!vehicleSnap.exists) {
    throw new TripError("VEHICLE_NOT_FOUND", `Vehicle ${vehicleId} not found`);
  }

  const vehicle = vehicleSnap.data() ?? {};
  const currentEstimatedKm = Number(vehicle.estimatedKm ?? 0);
  const tripCount = Number(vehicle.estimatedKmTripCount ?? 0);

  // Incremental update: add the just-completed trip's distance
  if (justCompletedMetres !== undefined && justCompletedMetres > 0) {
    const addedKm = justCompletedMetres / 1000;
    const newEstimatedKm = Math.round((currentEstimatedKm + addedKm) * 100) / 100;
    const nowIso = new Date().toISOString();
    tx.update(vehicleRef, {
      estimatedKm: newEstimatedKm,
      estimatedKmUpdatedAt: nowIso,
      estimatedKmTripCount: tripCount + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { estimatedKm: newEstimatedKm, tripCount: tripCount + 1 };
  }

  // Fallback: full recompute using a cursor-based scan.
  // Firestore limits transaction queries; we fetch all COMPLETED trips
  // for the vehicle in batches so no trips are silently dropped.
  const odometerKm = Number(vehicle.odometerKm ?? 0);
  const odometerAt = vehicle.odometerAt;

  const allCompletedTrips: Trip[] = [];
  let cursor: import("firebase-admin/firestore").QueryDocumentSnapshot | null = null;
  const BATCH = 500;
  for (;;) {
    let q = tripsRef()
      .where("vehicleId", "==", vehicleId)
      .where("status", "==", "COMPLETED")
      .orderBy("createdAt", "asc")
      .limit(BATCH);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    for (const doc of snap.docs) {
      allCompletedTrips.push(toTrip(doc.id, doc.data()));
    }
    if (snap.docs.length < BATCH) break;
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (!cursor) break;
  }

  const baselineAt = odometerAt
    ? (toDate(odometerAt)?.toISOString() ?? new Date(0).toISOString())
    : new Date(0).toISOString();

  const projection = computeEstimatedProjection(odometerKm, baselineAt, allCompletedTrips);

  const nowIso = new Date().toISOString();
  tx.update(vehicleRef, {
    estimatedKm: projection.estimatedKm,
    estimatedKmUpdatedAt: nowIso,
    estimatedKmTripCount: projection.tripCount,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { estimatedKm: projection.estimatedKm, tripCount: projection.tripCount };
}
