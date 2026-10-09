import type { DocumentData } from "firebase-admin/firestore";

import type { WorkOrder, WorkOrderStatus } from "@/lib/domain/work-order";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import { toDate } from "@/lib/repos/timestamps";

/** Firestore-backed work order repository. */

function workOrdersRef() {
  return getAdminDb().collection(COLLECTIONS.workOrders);
}

function toWorkOrder(id: string, data: DocumentData): WorkOrder {
  return {
    id,
    vehicleId: String(data.vehicleId ?? ""),
    reportId: data.reportId ? String(data.reportId) : undefined,
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    priority: (data.priority ?? "NORMAL") as WorkOrder["priority"],
    status: (data.status ?? "OPEN") as WorkOrderStatus,
    assignedTo: data.assignedTo ? String(data.assignedTo) : undefined,
    completedAt: toDate(data.completedAt),
    closedAt: toDate(data.closedAt),
    createdAt: toDate(data.createdAt) ?? new Date(0),
    updatedAt: toDate(data.updatedAt) ?? new Date(0),
    createdBy: String(data.createdBy ?? ""),
  };
}

export interface CreateWorkOrderInput {
  vehicleId: string;
  reportId?: string;
  title: string;
  description: string;
  priority: WorkOrder["priority"];
  assignedTo?: string;
  createdBy: string;
}

export async function createWorkOrder(input: CreateWorkOrderInput): Promise<WorkOrder> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const now = FieldValue.serverTimestamp();
  const doc = await workOrdersRef().add({
    ...input,
    reportId: input.reportId ?? null,
    assignedTo: input.assignedTo ?? null,
    status: "OPEN",
    createdAt: now,
    updatedAt: now,
  });
  const created = await getWorkOrderById(doc.id);
  if (!created) throw new Error("Work order not found after creation");
  return created;
}

export async function getWorkOrderById(id: string): Promise<WorkOrder | null> {
  const snap = await workOrdersRef().doc(id).get();
  if (!snap.exists) return null;
  return toWorkOrder(snap.id, snap.data() ?? {});
}

export async function listWorkOrders(options?: {
  vehicleId?: string;
  status?: WorkOrderStatus;
  includeClosed?: boolean;
  limit?: number;
}): Promise<WorkOrder[]> {
  let query: import("firebase-admin/firestore").Query = workOrdersRef();
  if (options?.vehicleId) {
    query = query.where("vehicleId", "==", options.vehicleId);
  }
  if (options?.status) {
    query = query.where("status", "==", options.status);
  }
  // Equality-only filters + in-memory ordering: avoids composite indexes.
  const snap = await query.limit(2000).get();
  return snap.docs
    .map((doc) => toWorkOrder(doc.id, doc.data()))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, options?.limit ?? 500);
}

/**
 * Count work orders for a vehicle that block archiving —
 * i.e. anything not CLOSED.
 */
export async function countOpenWorkOrders(vehicleId: string): Promise<number> {
  const snap = await workOrdersRef().where("vehicleId", "==", vehicleId).get();
  return snap.docs.filter((doc) => doc.data().status !== "CLOSED").length;
}

export interface UpdateWorkOrderFields {
  title?: string;
  description?: string;
  priority?: WorkOrder["priority"];
  assignedTo?: string;
}

export async function updateWorkOrder(
  id: string,
  fields: UpdateWorkOrderFields,
): Promise<WorkOrder> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (fields.title !== undefined) update.title = fields.title;
  if (fields.description !== undefined) update.description = fields.description;
  if (fields.priority !== undefined) update.priority = fields.priority;
  if (fields.assignedTo !== undefined) update.assignedTo = fields.assignedTo;
  await workOrdersRef().doc(id).update(update);
  const updated = await getWorkOrderById(id);
  if (!updated) throw new Error("Work order not found after update");
  return updated;
}

/** Apply a lifecycle transition with actor-relevant timestamps. */
export async function applyWorkOrderStatus(
  id: string,
  status: WorkOrderStatus,
): Promise<WorkOrder> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const update: Record<string, unknown> = {
    status,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (status === "COMPLETED") {
    update.completedAt = FieldValue.serverTimestamp();
  }
  if (status === "CLOSED") {
    update.closedAt = FieldValue.serverTimestamp();
  }
  if (status === "OPEN") {
    // Reopen clears completion/closure evidence.
    update.completedAt = null;
    update.closedAt = null;
  }
  await workOrdersRef().doc(id).update(update);
  const updated = await getWorkOrderById(id);
  if (!updated) throw new Error("Work order not found after status change");
  return updated;
}
