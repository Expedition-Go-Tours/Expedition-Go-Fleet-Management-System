import type { DocumentData } from "firebase-admin/firestore";

import type { VehicleAssignment, AssignmentStatus } from "@/lib/domain/assignment";
import { computeTripDistance } from "@/lib/domain/assignment";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import { toDate } from "@/lib/repos/timestamps";

/** Firestore-backed vehicle assignment repository. */

function assignmentsRef() {
  return getAdminDb().collection(COLLECTIONS.assignments);
}

function toAssignment(id: string, data: DocumentData): VehicleAssignment {
  return {
    id,
    vehicleId: String(data.vehicleId ?? ""),
    driverUserId: String(data.driverUserId ?? ""),
    purpose: (data.purpose ?? "OTHER") as VehicleAssignment["purpose"],
    externalReference: data.externalReference ? String(data.externalReference) : undefined,
    notes: data.notes ? String(data.notes) : undefined,
    status: (data.status ?? "ACTIVE") as AssignmentStatus,
    startedAt: toDate(data.startedAt),
    startOdometerKm: typeof data.startOdometerKm === "number" ? data.startOdometerKm : undefined,
    startOdometerReadingId: data.startOdometerReadingId
      ? String(data.startOdometerReadingId)
      : undefined,
    endedAt: toDate(data.endedAt),
    endOdometerKm: typeof data.endOdometerKm === "number" ? data.endOdometerKm : undefined,
    endOdometerReadingId: data.endOdometerReadingId ? String(data.endOdometerReadingId) : undefined,
    distanceKm: typeof data.distanceKm === "number" ? data.distanceKm : undefined,
    createdBy: String(data.createdBy ?? ""),
    createdAt: toDate(data.createdAt) ?? new Date(0),
    updatedAt: toDate(data.updatedAt) ?? new Date(0),
  };
}

/** The single active assignment for a vehicle, if any. */
export async function getActiveAssignmentForVehicle(
  vehicleId: string,
): Promise<VehicleAssignment | null> {
  const snap = await assignmentsRef().where("vehicleId", "==", vehicleId).limit(500).get();
  return (
    snap.docs.map((d) => toAssignment(d.id, d.data())).find((a) => a.status === "ACTIVE") ?? null
  );
}

/** The driver's current active assignment, if any. */
export async function getActiveAssignmentForDriver(
  driverUserId: string,
): Promise<VehicleAssignment | null> {
  const snap = await assignmentsRef().where("driverUserId", "==", driverUserId).limit(500).get();
  return (
    snap.docs.map((d) => toAssignment(d.id, d.data())).find((a) => a.status === "ACTIVE") ?? null
  );
}

export interface StartAssignmentInput {
  vehicleId: string;
  driverUserId: string;
  purpose: VehicleAssignment["purpose"];
  externalReference?: string;
  notes?: string;
  /** Start odometer captured at assignment start. */
  startOdometerKm: number;
  startOdometerReadingId?: string;
  createdBy: string;
}

/**
 * Raised when a vehicle/driver reservation cannot be acquired. The API layer
 * maps this to HTTP 409.
 */
export class AssignmentConflictError extends Error {
  readonly code = "ASSIGNMENT_CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "AssignmentConflictError";
  }
}

/** Deterministic reservation documents — competing writers contend on these. */
function vehicleReservationRef(vehicleId: string) {
  return getAdminDb().collection(COLLECTIONS.assignmentReservations).doc(`vehicle:${vehicleId}`);
}

function driverReservationRef(driverUserId: string) {
  return getAdminDb().collection(COLLECTIONS.assignmentReservations).doc(`driver:${driverUserId}`);
}

/**
 * Create an ACTIVE assignment while atomically reserving the vehicle and the
 * driver.
 *
 * The invariant is enforced by two deterministic reservation documents
 * (`assignmentReservations/vehicle:<id>` and `…/driver:<id>`). Because every
 * writer must read and write the SAME document inside a Firestore transaction,
 * two simultaneous requests serialise: the loser observes the winner's
 * reservation and fails with AssignmentConflictError. This is not a query
 * check-then-write (which races) and not a process-local mutex (which does not
 * span serverless instances).
 *
 * The assignment record and both reservations are written in the one
 * transaction, so the active-assignment projection cannot disagree with the
 * authoritative assignment row.
 */
export async function reserveAssignment(input: StartAssignmentInput): Promise<VehicleAssignment> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const db = getAdminDb();
  const assignmentRef = assignmentsRef().doc();
  const vehicleRef = db.collection(COLLECTIONS.vehicles).doc(input.vehicleId);
  const vResRef = vehicleReservationRef(input.vehicleId);
  const dResRef = driverReservationRef(input.driverUserId);

  await db.runTransaction(async (tx) => {
    // All reads happen before any write (Firestore transaction requirement).
    const vehicleSnap = await tx.get(vehicleRef);
    if (!vehicleSnap.exists) throw new AssignmentConflictError("Unknown vehicle");
    const vehicleStatus = String(vehicleSnap.data()?.status ?? "");
    if (vehicleStatus === "ARCHIVED") {
      throw new AssignmentConflictError("Cannot assign an archived vehicle");
    }
    if (vehicleStatus === "SAFETY_HOLD") {
      throw new AssignmentConflictError("Vehicle is on safety hold");
    }
    if (vehicleStatus === "IN_SERVICE") {
      throw new AssignmentConflictError("Vehicle is in the workshop");
    }

    const vRes = await tx.get(vResRef);
    if (vRes.exists && String(vRes.data()?.status ?? "") === "ACTIVE") {
      throw new AssignmentConflictError("Vehicle already has an active assignment");
    }
    const dRes = await tx.get(dResRef);
    if (dRes.exists && String(dRes.data()?.status ?? "") === "ACTIVE") {
      throw new AssignmentConflictError("Driver already has an active assignment");
    }

    const now = FieldValue.serverTimestamp();
    const reservation = {
      assignmentId: assignmentRef.id,
      vehicleId: input.vehicleId,
      driverUserId: input.driverUserId,
      status: "ACTIVE",
      updatedAt: now,
    };
    tx.set(assignmentRef, {
      vehicleId: input.vehicleId,
      driverUserId: input.driverUserId,
      purpose: input.purpose,
      externalReference: input.externalReference ?? null,
      notes: input.notes ?? null,
      startOdometerKm: input.startOdometerKm,
      startOdometerReadingId: input.startOdometerReadingId ?? null,
      status: "ACTIVE",
      startedAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
    });
    tx.set(vResRef, reservation);
    tx.set(dResRef, reservation);
  });

  const created = await getAssignmentById(assignmentRef.id);
  if (!created) throw new Error("Assignment not found after creation");
  return created;
}

/**
 * Attach the start odometer reading id to an assignment after the ledger write.
 * Kept separate so the ledger keeps its own idempotency token; the assignment
 * already exists (reserved), so a failure here is reported and compensated by
 * the caller rather than silently ignored.
 */
export async function setAssignmentStartReading(
  id: string,
  startOdometerReadingId: string,
): Promise<void> {
  const { FieldValue } = await import("firebase-admin/firestore");
  await assignmentsRef().doc(id).update({
    startOdometerReadingId,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function getAssignmentById(id: string): Promise<VehicleAssignment | null> {
  const snap = await assignmentsRef().doc(id).get();
  if (!snap.exists) return null;
  return toAssignment(snap.id, snap.data() ?? {});
}

export async function listAssignments(options?: {
  vehicleId?: string;
  driverUserId?: string;
  status?: AssignmentStatus;
  limit?: number;
}): Promise<VehicleAssignment[]> {
  let query: import("firebase-admin/firestore").Query = assignmentsRef();
  if (options?.vehicleId) query = query.where("vehicleId", "==", options.vehicleId);
  if (options?.driverUserId) query = query.where("driverUserId", "==", options.driverUserId);
  if (options?.status) query = query.where("status", "==", options.status);
  const snap = await query.limit(2000).get();
  return snap.docs
    .map((d) => toAssignment(d.id, d.data()))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, options?.limit ?? 100);
}

/** Count assignments matching the list filters via aggregation. */
export async function countAssignments(options?: {
  vehicleId?: string;
  driverUserId?: string;
  status?: AssignmentStatus;
}): Promise<number> {
  let query: import("firebase-admin/firestore").Query = assignmentsRef();
  if (options?.vehicleId) query = query.where("vehicleId", "==", options.vehicleId);
  if (options?.driverUserId) query = query.where("driverUserId", "==", options.driverUserId);
  if (options?.status) query = query.where("status", "==", options.status);
  const snap = await query.count().get();
  return snap.data().count;
}

/**
 * Complete an assignment with the end odometer. The trip distance is
 * computed from the accepted readings — a lower end reading marks the
 * assignment with a conflict instead of producing a negative distance.
 *
 * Runs in a transaction so the status flip and the release of the vehicle and
 * driver reservations happen together; the vehicle becomes assignable only
 * once the assignment is genuinely COMPLETED.
 */
export async function completeAssignment(
  id: string,
  input: {
    endOdometerKm: number;
    endOdometerReadingId?: string;
    notes?: string;
  },
): Promise<VehicleAssignment> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const db = getAdminDb();
  const ref = assignmentsRef().doc(id);

  await db.runTransaction(async (tx) => {
    // Reads first.
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("Assignment not found");
    const assignment = toAssignment(snap.id, snap.data() ?? {});
    if (assignment.status !== "ACTIVE") {
      throw new AssignmentConflictError(`Assignment is already ${assignment.status}`);
    }
    const vResRef = vehicleReservationRef(assignment.vehicleId);
    const dResRef = driverReservationRef(assignment.driverUserId);
    const vRes = await tx.get(vResRef);
    const dRes = await tx.get(dResRef);

    const { distanceKm, conflict } = computeTripDistance(
      assignment.startOdometerKm,
      input.endOdometerKm,
    );

    // Writes.
    tx.update(ref, {
      status: "COMPLETED",
      endedAt: FieldValue.serverTimestamp(),
      endOdometerKm: input.endOdometerKm,
      endOdometerReadingId: input.endOdometerReadingId ?? null,
      distanceKm: distanceKm ?? null,
      conflictNote: conflict ? "End odometer is below start odometer" : null,
      notes: input.notes ? input.notes.slice(0, 1000) : (assignment.notes ?? null),
      updatedAt: FieldValue.serverTimestamp(),
    });
    // Release only reservations that still belong to THIS assignment.
    if (vRes.exists && String(vRes.data()?.assignmentId ?? "") === id) tx.delete(vResRef);
    if (dRes.exists && String(dRes.data()?.assignmentId ?? "") === id) tx.delete(dResRef);
  });

  const updated = await getAssignmentById(id);
  if (!updated) throw new Error("Assignment not found after completion");
  return updated;
}

/**
 * Cancel an active assignment and release its reservations atomically.
 * Cancelling an already-terminal assignment is a no-op that still guarantees
 * the reservation documents are cleared.
 */
export async function cancelAssignment(id: string, reason?: string): Promise<VehicleAssignment> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const db = getAdminDb();
  const ref = assignmentsRef().doc(id);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("Assignment not found");
    const assignment = toAssignment(snap.id, snap.data() ?? {});
    const vResRef = vehicleReservationRef(assignment.vehicleId);
    const dResRef = driverReservationRef(assignment.driverUserId);
    const vRes = await tx.get(vResRef);
    const dRes = await tx.get(dResRef);

    if (assignment.status === "ACTIVE") {
      tx.update(ref, {
        status: "CANCELLED",
        cancelReason: reason?.slice(0, 500) ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    if (vRes.exists && String(vRes.data()?.assignmentId ?? "") === id) tx.delete(vResRef);
    if (dRes.exists && String(dRes.data()?.assignmentId ?? "") === id) tx.delete(dResRef);
  });

  const updated = await getAssignmentById(id);
  if (!updated) throw new Error("Assignment not found after cancel");
  return updated;
}

/**
 * Reconciliation for reservation documents.
 *
 *  - Clears any reservation whose assignment is missing or no longer ACTIVE.
 *  - Backfills a reservation for any ACTIVE assignment that predates the
 *    reservation scheme (or lost its reservation), keyed by vehicle/driver.
 *
 * This is the mechanism that repairs state if a multi-step start/complete ever
 * failed between writes, and it makes legacy data safe to reassign. Safe to
 * run repeatedly; returns the number of reservations released and created.
 */
export async function reconcileAssignmentReservations(
  limit = 500,
): Promise<{ released: number; backfilled: number }> {
  const db = getAdminDb();
  let released = 0;
  let backfilled = 0;

  // 1. Release reservations that no longer correspond to an ACTIVE assignment.
  const activeReservations = await db
    .collection(COLLECTIONS.assignmentReservations)
    .where("status", "==", "ACTIVE")
    .limit(limit)
    .get();
  for (const doc of activeReservations.docs) {
    const assignmentId = String(doc.data().assignmentId ?? "");
    const assignment = assignmentId ? await getAssignmentById(assignmentId) : null;
    if (!assignment || assignment.status !== "ACTIVE") {
      await doc.ref.delete();
      released += 1;
    }
  }

  // 2. Backfill a reservation for every ACTIVE assignment that lacks one.
  const activeAssignments = await assignmentsRef()
    .where("status", "==", "ACTIVE")
    .limit(limit)
    .get();
  for (const doc of activeAssignments.docs) {
    const assignment = toAssignment(doc.id, doc.data());
    const { FieldValue } = await import("firebase-admin/firestore");
    const reservation = {
      assignmentId: assignment.id,
      vehicleId: assignment.vehicleId,
      driverUserId: assignment.driverUserId,
      status: "ACTIVE",
      updatedAt: FieldValue.serverTimestamp(),
    };
    const vRef = vehicleReservationRef(assignment.vehicleId);
    const dRef = driverReservationRef(assignment.driverUserId);
    const [vSnap, dSnap] = await Promise.all([vRef.get(), dRef.get()]);
    if (!vSnap.exists || String(vSnap.data()?.assignmentId ?? "") !== assignment.id) {
      await vRef.set(reservation);
      if (!vSnap.exists) backfilled += 1;
    }
    if (!dSnap.exists || String(dSnap.data()?.assignmentId ?? "") !== assignment.id) {
      await dRef.set(reservation);
      if (!dSnap.exists) backfilled += 1;
    }
  }

  return { released, backfilled };
}
