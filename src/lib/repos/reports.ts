import type { DocumentData } from "firebase-admin/firestore";

import type { MaintenanceReport, ReportStatus } from "@/lib/domain/report";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import { toDate } from "@/lib/repos/timestamps";

/** Firestore-backed maintenance report repository. */

function reportsRef() {
  return getAdminDb().collection(COLLECTIONS.maintenanceReports);
}

function toReport(id: string, data: DocumentData): MaintenanceReport {
  return {
    id,
    vehicleId: String(data.vehicleId ?? ""),
    reportedBy: String(data.reportedBy ?? ""),
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    severity: (data.severity ?? "LOW") as MaintenanceReport["severity"],
    status: (data.status ?? "OPEN") as ReportStatus,
    workOrderId: data.workOrderId ? String(data.workOrderId) : undefined,
    triagedBy: data.triagedBy ? String(data.triagedBy) : undefined,
    triagedAt: toDate(data.triagedAt),
    closedBy: data.closedBy ? String(data.closedBy) : undefined,
    closedAt: toDate(data.closedAt),
    createdAt: toDate(data.createdAt) ?? new Date(0),
    updatedAt: toDate(data.updatedAt) ?? new Date(0),
  };
}

export interface CreateReportInput {
  vehicleId: string;
  reportedBy: string;
  title: string;
  description: string;
  severity: MaintenanceReport["severity"];
}

export async function createReport(input: CreateReportInput): Promise<MaintenanceReport> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const now = FieldValue.serverTimestamp();
  const doc = await reportsRef().add({ ...input, status: "OPEN", createdAt: now, updatedAt: now });
  const created = await getReportById(doc.id);
  if (!created) throw new Error("Report not found after creation");
  return created;
}

export async function getReportById(id: string): Promise<MaintenanceReport | null> {
  const snap = await reportsRef().doc(id).get();
  if (!snap.exists) return null;
  return toReport(snap.id, snap.data() ?? {});
}

/**
 * List reports, newest first.
 * When `scopeUserId` is given, only that user's reports are returned
 * (report:read:own). Otherwise all reports are returned (report:read:all).
 */
export async function listReports(options?: {
  scopeUserId?: string;
  vehicleId?: string;
  status?: ReportStatus;
  limit?: number;
}): Promise<MaintenanceReport[]> {
  let query: import("firebase-admin/firestore").Query = reportsRef();
  if (options?.scopeUserId) {
    query = query.where("reportedBy", "==", options.scopeUserId);
  }
  if (options?.vehicleId) {
    query = query.where("vehicleId", "==", options.vehicleId);
  }
  if (options?.status) {
    query = query.where("status", "==", options.status);
  }
  // Equality-only filters (single-field indexes, no composite index needed);
  // ordering/limiting in memory — report collections stay small internally.
  const snap = await query.limit(2000).get();
  return snap.docs
    .map((doc) => toReport(doc.id, doc.data()))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, options?.limit ?? 500);
}

/** Record a lifecycle transition (triage/close) with actor + timestamps. */
export async function applyReportStatus(
  id: string,
  status: ReportStatus,
  actorId: string,
): Promise<MaintenanceReport> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const update: Record<string, unknown> = {
    status,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (status === "TRIAGED") {
    update.triagedBy = actorId;
    update.triagedAt = FieldValue.serverTimestamp();
  }
  if (status === "CLOSED") {
    update.closedBy = actorId;
    update.closedAt = FieldValue.serverTimestamp();
  }
  await reportsRef().doc(id).update(update);
  const updated = await getReportById(id);
  if (!updated) throw new Error("Report not found after status change");
  return updated;
}

/** Link a work order to its source report. */
export async function linkReportToWorkOrder(reportId: string, workOrderId: string): Promise<void> {
  const { FieldValue } = await import("firebase-admin/firestore");
  await reportsRef().doc(reportId).update({
    workOrderId,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
