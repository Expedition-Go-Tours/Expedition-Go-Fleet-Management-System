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

export async function startAssignment(input: StartAssignmentInput): Promise<VehicleAssignment> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const now = FieldValue.serverTimestamp();
  const doc = await assignmentsRef().add({
    ...input,
    externalReference: input.externalReference ?? null,
    notes: input.notes ?? null,
    startOdometerReadingId: input.startOdometerReadingId ?? null,
    status: "ACTIVE",
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const created = await getAssignmentById(doc.id);
  if (!created) throw new Error("Assignment not found after creation");
  return created;
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
  const assignment = await getAssignmentById(id);
  if (!assignment) throw new Error("Assignment not found");

  const { distanceKm, complete, conflict } = computeTripDistance(
    assignment.startOdometerKm,
    input.endOdometerKm,
  );

  await assignmentsRef()
    .doc(id)
    .update({
      status: "COMPLETED",
      endedAt: FieldValue.serverTimestamp(),
      endOdometerKm: input.endOdometerKm,
      endOdometerReadingId: input.endOdometerReadingId ?? null,
      distanceKm: distanceKm ?? null,
      conflictNote: conflict ? "End odometer is below start odometer" : null,
      notes: input.notes ? input.notes.slice(0, 1000) : (assignment.notes ?? null),
      updatedAt: FieldValue.serverTimestamp(),
    });

  const updated = await getAssignmentById(id);
  if (!updated) throw new Error("Assignment not found after completion");
  void complete;
  return updated;
}

export async function cancelAssignment(id: string, reason?: string): Promise<VehicleAssignment> {
  const { FieldValue } = await import("firebase-admin/firestore");
  await assignmentsRef()
    .doc(id)
    .update({
      status: "CANCELLED",
      cancelReason: reason?.slice(0, 500) ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  const updated = await getAssignmentById(id);
  if (!updated) throw new Error("Assignment not found after cancel");
  return updated;
}
