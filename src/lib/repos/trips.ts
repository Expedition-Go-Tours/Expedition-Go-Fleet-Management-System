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
  computeEstimatedProjection,
  deriveOriginDestination,
  generateIdempotencyKey,
  validateTripCompletion,
  validateTripForSave,
} from "@/lib/domain/trip";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
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

function toTrip(id: string, data: DocumentData): Trip {
  const stops = (data.stops ?? []) as TripStop[];
  const { origin, destination } =
    stops.length >= 2
      ? deriveOriginDestination(stops)
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
  const ref = tripsRef().doc();

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

  await ref.set({
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

  await writeAuditEvent({
    eventType: AUDIT_EVENTS.TRIP_CREATED,
    actorId: input.recordedByUserId,
    entityType: "trip",
    entityId: ref.id,
    after: { vehicleId: input.vehicleId, purpose: input.purpose },
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

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.TRIP_UPDATED,
      actorId,
      entityType: "trip",
      entityId: id,
      before: { status: existing.status },
      after: updateData,
    });

    const updatedSnap = await tx.get(ref);
    return toTrip(updatedSnap.id, updatedSnap.data() ?? {});
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
    const snap = await tx.get(ref);
    if (!snap.exists) throw new TripError("NOT_FOUND", "Trip not found");
    const trip = toTrip(snap.id, snap.data() ?? {});

    // Idempotency: if already completed with the same key, return as-is
    if (trip.status === "COMPLETED") {
      return { trip, projectionUpdated: false };
    }

    // Merge completion inputs for validation
    const tripForValidation: Trip = {
      ...trip,
      startOdometerKm: input.startOdometerKm ?? trip.startOdometerKm,
      endOdometerKm: input.endOdometerKm ?? trip.endOdometerKm,
    };
    const validation = validateTripCompletion(tripForValidation);
    if (!validation.ok) {
      throw new TripError("VALIDATION_FAILED", validation.error);
    }

    // Compute distance basis and actual distance
    const startOdo = input.startOdometerKm ?? trip.startOdometerKm;
    const endOdo = input.endOdometerKm ?? trip.endOdometerKm;
    const actualDistanceKm = computeActualDistance(startOdo, endOdo);

    let distanceBasis: DistanceBasis = trip.distanceBasis;
    if (actualDistanceKm !== null) {
      distanceBasis = "ACTUAL_ODOMETER";
    } else if (trip.routeDistanceM !== null && trip.routeDistanceM > 0) {
      distanceBasis = "ROUTE_ESTIMATE";
    } else if (trip.manualDistanceKm !== null) {
      distanceBasis = "MANUAL_OVERRIDE";
    }

    const now = FieldValue.serverTimestamp();

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

    // Reconcile vehicle estimated km
    let projectionUpdated = false;
    try {
      const result = await reconcileVehicleEstimatedKmInTx(tx, trip.vehicleId);
      projectionUpdated = result.tripCount > 0;
    } catch {
      // Non-fatal: log but don't fail the completion
      console.error("[trips] failed to reconcile vehicle estimated km for", trip.vehicleId);
    }

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.TRIP_COMPLETED,
      actorId: input.actorId,
      entityType: "trip",
      entityId: id,
      after: { status: "COMPLETED", distanceBasis, actualDistanceKm },
    });

    // Read back the final state
    const finalSnap = await tx.get(ref);
    return { trip: toTrip(finalSnap.id, finalSnap.data() ?? {}), projectionUpdated };
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

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.TRIP_CANCELLED,
      actorId,
      entityType: "trip",
      entityId: id,
      reason,
    });

    const updatedSnap = await tx.get(ref);
    return toTrip(updatedSnap.id, updatedSnap.data() ?? {});
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

export async function saveRouteCalculation(
  tripId: string,
  route: RouteResult,
  legs: RouteLeg[],
): Promise<Trip> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const ref = tripsRef().doc(tripId);

  const snap = await ref.get();
  if (!snap.exists) throw new TripError("NOT_FOUND", "Trip not found");

  await ref.update({
    routeDistanceM: route.totalDistanceM,
    routeDistanceKm: Math.round((route.totalDistanceM / 1000) * 100) / 100,
    routeDurationS: route.totalDurationS,
    routingProvider: route.provider,
    routeCalculatedAt: route.calculatedAt,
    routeProviderMeta: route.providerMeta ?? null,
    routeLegs: legs,
    routeStale: false,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAuditEvent({
    eventType: AUDIT_EVENTS.TRIP_ROUTE_CALCULATED,
    entityType: "trip",
    entityId: tripId,
    after: {
      provider: route.provider,
      distanceM: route.totalDistanceM,
      durationS: route.totalDurationS,
    },
  });

  const updated = await ref.get();
  return toTrip(updated.id, updated.data() ?? {});
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
 */
async function reconcileVehicleEstimatedKmInTx(
  tx: import("firebase-admin/firestore").Transaction,
  vehicleId: string,
): Promise<{ estimatedKm: number; tripCount: number }> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const db = getAdminDb();
  const vehicleRef = db.collection(COLLECTIONS.vehicles).doc(vehicleId);
  const vehicleSnap = await tx.get(vehicleRef);
  if (!vehicleSnap.exists) {
    throw new TripError("VEHICLE_NOT_FOUND", `Vehicle ${vehicleId} not found`);
  }

  const vehicle = vehicleSnap.data() ?? {};
  const odometerKm = Number(vehicle.odometerKm ?? 0);
  const odometerAt = vehicle.odometerAt;

  // Get all completed trips for this vehicle
  const tripsSnap = await tripsRef()
    .where("vehicleId", "==", vehicleId)
    .where("status", "==", "COMPLETED")
    .limit(5000)
    .get();

  const completedTrips = tripsSnap.docs.map((d) => toTrip(d.id, d.data()));

  // Compute projection from baseline
  const baselineAt = odometerAt
    ? (toDate(odometerAt)?.toISOString() ?? new Date(0).toISOString())
    : new Date(0).toISOString();

  const projection = computeEstimatedProjection(odometerKm, baselineAt, completedTrips);

  // Update vehicle document
  const nowIso = new Date().toISOString();
  tx.update(vehicleRef, {
    estimatedKm: projection.estimatedKm,
    estimatedKmUpdatedAt: nowIso,
    estimatedKmTripCount: projection.tripCount,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { estimatedKm: projection.estimatedKm, tripCount: projection.tripCount };
}
