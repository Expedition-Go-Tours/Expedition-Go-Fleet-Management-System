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
    number: String(data.number ?? ""),
    vehicleId: String(data.vehicleId ?? ""),
    issueIds: Array.isArray(data.issueIds) ? data.issueIds.map(String) : [],
    scheduleIds: Array.isArray(data.scheduleIds) ? data.scheduleIds.map(String) : [],
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    priority: (data.priority ?? "NORMAL") as WorkOrder["priority"],
    status: (data.status ?? "OPEN") as WorkOrderStatus,
    assignedToUserId: data.assignedToUserId ? String(data.assignedToUserId) : undefined,
    providerId: data.providerId ? String(data.providerId) : undefined,
    providerName: data.providerName ? String(data.providerName) : undefined,
    openedAt: toDate(data.openedAt) ?? new Date(0),
    startedAt: toDate(data.startedAt),
    waitingSince: toDate(data.waitingSince),
    waitingReason: data.waitingReason ? String(data.waitingReason) : undefined,
    completedAt: toDate(data.completedAt),
    completionOdometerKm:
      typeof data.completionOdometerKm === "number" ? data.completionOdometerKm : undefined,
    workPerformed: data.workPerformed ? String(data.workPerformed) : undefined,
    outcome: data.outcome ? String(data.outcome) : undefined,
    completedByUserId: data.completedByUserId ? String(data.completedByUserId) : undefined,
    serviceRecordId: data.serviceRecordId ? String(data.serviceRecordId) : undefined,
    verifiedAt: toDate(data.verifiedAt),
    verifiedByUserId: data.verifiedByUserId ? String(data.verifiedByUserId) : undefined,
    verificationNote: data.verificationNote ? String(data.verificationNote) : undefined,
    closedAt: toDate(data.closedAt),
    createdAt: toDate(data.createdAt) ?? new Date(0),
    updatedAt: toDate(data.updatedAt) ?? new Date(0),
    createdBy: String(data.createdBy ?? ""),
  };
}

/** Human-readable work-order number: WO-YYYY-NNNNNN. */
async function nextWorkOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const counterRef = getAdminDb().collection("counters").doc(`workOrders-${year}`);
  const snap = await counterRef.get();
  const next = Number(snap.data()?.value ?? 0) + 1;
  await counterRef.set({ value: next }, { merge: true });
  return `WO-${year}-${String(next).padStart(6, "0")}`;
}

export interface CreateWorkOrderInput {
  vehicleId: string;
  issueIds?: string[];
  scheduleIds?: string[];
  title: string;
  description: string;
  priority: WorkOrder["priority"];
  assignedToUserId?: string;
  providerId?: string;
  providerName?: string;
  createdBy: string;
}

export async function createWorkOrder(input: CreateWorkOrderInput): Promise<WorkOrder> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const now = FieldValue.serverTimestamp();
  const number = await nextWorkOrderNumber();
  const doc = await workOrdersRef().add({
    ...input,
    number,
    issueIds: input.issueIds ?? [],
    scheduleIds: input.scheduleIds ?? [],
    assignedToUserId: input.assignedToUserId ?? null,
    providerId: input.providerId ?? null,
    providerName: input.providerName ?? null,
    status: "OPEN",
    openedAt: now,
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
  assignedToUserId?: string;
  limit?: number;
}): Promise<WorkOrder[]> {
  // Equality-only filters + in-memory ordering: avoids composite indexes.
  let query: import("firebase-admin/firestore").Query = workOrdersRef();
  if (options?.vehicleId) {
    query = query.where("vehicleId", "==", options.vehicleId);
  }
  if (options?.status) {
    query = query.where("status", "==", options.status);
  }
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

/**
 * Count work orders matching the same equality filters as `listWorkOrders`
 * using a Firestore aggregation — nothing is truncated by a `limit`, so a
 * displayed count is never capped by how many rows the page happened to fetch.
 */
export async function countWorkOrders(options?: {
  vehicleId?: string;
  status?: WorkOrderStatus;
}): Promise<number> {
  let query: import("firebase-admin/firestore").Query = workOrdersRef();
  if (options?.vehicleId) query = query.where("vehicleId", "==", options.vehicleId);
  if (options?.status) query = query.where("status", "==", options.status);
  const snap = await query.count().get();
  return snap.data().count;
}

/**
 * Total work orders and the "actively open" subset (OPEN, IN_PROGRESS,
 * WAITING). COMPLETED/VERIFIED are awaiting closure, not open, and are
 * excluded — matching the control-centre KPI definition.
 */
export async function countWorkOrderTotals(options?: {
  vehicleId?: string;
}): Promise<{ total: number; open: number }> {
  const [total, open, inProgress, waiting] = await Promise.all([
    countWorkOrders(options),
    countWorkOrders({ ...options, status: "OPEN" }),
    countWorkOrders({ ...options, status: "IN_PROGRESS" }),
    countWorkOrders({ ...options, status: "WAITING" }),
  ]);
  return { total, open: open + inProgress + waiting };
}

export interface UpdateWorkOrderFields {
  title?: string;
  description?: string;
  priority?: WorkOrder["priority"];
  assignedToUserId?: string;
  providerId?: string;
  providerName?: string;
}

export async function updateWorkOrder(
  id: string,
  fields: UpdateWorkOrderFields,
): Promise<WorkOrder> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) update[key] = value;
  }
  await workOrdersRef().doc(id).update(update);
  const updated = await getWorkOrderById(id);
  if (!updated) throw new Error("Work order not found after update");
  return updated;
}

/** Apply a lifecycle transition with actor-relevant timestamps. */
export async function applyWorkOrderStatus(
  id: string,
  status: WorkOrderStatus,
  extra?: { waitingReason?: string },
): Promise<WorkOrder> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const update: Record<string, unknown> = {
    status,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (status === "IN_PROGRESS") {
    update.startedAt = FieldValue.serverTimestamp();
    update.waitingSince = null;
    update.waitingReason = null;
  }
  if (status === "WAITING") {
    update.waitingSince = FieldValue.serverTimestamp();
    update.waitingReason = extra?.waitingReason ?? null;
  }
  if (status === "CLOSED") {
    update.closedAt = FieldValue.serverTimestamp();
  }
  if (status === "OPEN") {
    // Reopen clears downstream evidence links; the service record remains.
    update.startedAt = null;
    update.completedAt = null;
    update.completionOdometerKm = null;
    update.workPerformed = null;
    update.completedByUserId = null;
    update.serviceRecordId = null;
    update.verifiedAt = null;
    update.verifiedByUserId = null;
    update.closedAt = null;
  }
  await workOrdersRef().doc(id).update(update);
  const updated = await getWorkOrderById(id);
  if (!updated) throw new Error("Work order not found after status change");
  return updated;
}

/** Record verification (authorized check before close). */
export async function verifyWorkOrder(
  id: string,
  userId: string,
  note?: string,
): Promise<WorkOrder> {
  const { FieldValue } = await import("firebase-admin/firestore");
  await workOrdersRef()
    .doc(id)
    .update({
      status: "VERIFIED",
      verifiedAt: FieldValue.serverTimestamp(),
      verifiedByUserId: userId,
      verificationNote: note?.slice(0, 2000) ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  const updated = await getWorkOrderById(id);
  if (!updated) throw new Error("Work order not found after verification");
  return updated;
}
