import type { DocumentData } from "firebase-admin/firestore";

import type { MaintenanceReport, ReportStatus } from "@/lib/domain/report";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import { toDate } from "@/lib/repos/timestamps";

/*
 * VehicleIssue repository (persisted in the legacy `maintenanceReports`
 * collection for audit continuity — see FLEET_DOMAIN_MODEL.md).
 */

/** Strip undefined values — Firestore rejects them as document fields. */
function definedOnly(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
}

function issuesRef() {
  return getAdminDb().collection(COLLECTIONS.maintenanceReports);
}

function toIssue(id: string, data: DocumentData): MaintenanceReport {
  return {
    id,
    number: data.number ? String(data.number) : undefined,
    vehicleId: String(data.vehicleId ?? ""),
    reportedBy: String(data.reportedBy ?? ""),
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    severity: (data.severity ?? "LOW") as MaintenanceReport["severity"],
    status: (data.status ?? "OPEN") as ReportStatus,
    category: data.category ? String(data.category) : undefined,
    safetyCritical: data.safetyCritical === true,
    affectsSafeOperation: data.affectsSafeOperation === true,
    immobilized: data.immobilized === true,
    odometerKm: typeof data.odometerKm === "number" ? data.odometerKm : undefined,
    assignmentId: data.assignmentId ? String(data.assignmentId) : undefined,
    inspectionId: data.inspectionId ? String(data.inspectionId) : undefined,
    inspectionItemId: data.inspectionItemId ? String(data.inspectionItemId) : undefined,
    location: data.location ? String(data.location) : undefined,
    immediateAction: data.immediateAction ? String(data.immediateAction) : undefined,
    evidenceKeys: Array.isArray(data.evidenceKeys) ? data.evidenceKeys.map(String) : [],
    workOrderId: data.workOrderId ? String(data.workOrderId) : undefined,
    linkedWorkOrderIds: Array.isArray(data.linkedWorkOrderIds)
      ? data.linkedWorkOrderIds.map(String)
      : [],
    duplicateOfIssueId: data.duplicateOfIssueId ? String(data.duplicateOfIssueId) : undefined,
    notActionableReason: data.notActionableReason ? String(data.notActionableReason) : undefined,
    triagedBy: data.triagedBy ? String(data.triagedBy) : undefined,
    triagedAt: toDate(data.triagedAt),
    closedBy: data.closedBy ? String(data.closedBy) : undefined,
    closedAt: toDate(data.closedAt),
    resolvedByWorkOrderId: data.resolvedByWorkOrderId
      ? String(data.resolvedByWorkOrderId)
      : undefined,
    resolvedAt: toDate(data.resolvedAt),
    resolution: data.resolution ? String(data.resolution) : undefined,
    followUps: Array.isArray(data.followUps)
      ? data.followUps.map((f: DocumentData) => ({
          byUserId: String(f.byUserId ?? ""),
          text: String(f.text ?? ""),
          at: toDate(f.at) ?? new Date(0),
          evidenceKeys: Array.isArray(f.evidenceKeys) ? f.evidenceKeys.map(String) : [],
        }))
      : [],
    createdAt: toDate(data.createdAt) ?? new Date(0),
    updatedAt: toDate(data.updatedAt) ?? new Date(0),
  };
}

/** Human-readable issue reference: ISS-YYYY-NNNNNN. */
async function nextIssueNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const counterRef = getAdminDb().collection("counters").doc(`issues-${year}`);
  const snap = await counterRef.get();
  const next = Number(snap.data()?.value ?? 0) + 1;
  await counterRef.set({ value: next }, { merge: true });
  return `ISS-${year}-${String(next).padStart(6, "0")}`;
}

export interface CreateIssueInput {
  vehicleId: string;
  reportedBy: string;
  title: string;
  description: string;
  severity: MaintenanceReport["severity"];
  category?: string;
  safetyCritical?: boolean;
  affectsSafeOperation?: boolean;
  immobilized?: boolean;
  odometerKm?: number;
  assignmentId?: string;
  inspectionId?: string;
  inspectionItemId?: string;
  location?: string;
  immediateAction?: string;
  evidenceKeys?: string[];
  /** Idempotency: retries reuse the caller's token → same issue. */
  clientToken?: string;
}

export async function createIssue(input: CreateIssueInput): Promise<MaintenanceReport> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const db = getAdminDb();

  // Idempotency: deterministic doc id from the client token when supplied.
  const docId = input.clientToken
    ? issuesRef().doc(`${input.vehicleId}_${input.clientToken}`).id
    : issuesRef().doc().id;
  const existing = await issuesRef().doc(docId).get();
  if (existing.exists) return toIssue(existing.id, existing.data() ?? {});

  const number = await nextIssueNumber();
  const now = FieldValue.serverTimestamp();
  await issuesRef()
    .doc(docId)
    .set(
      definedOnly({
        ...input,
        number,
        safetyCritical: input.safetyCritical ?? false,
        affectsSafeOperation: input.affectsSafeOperation ?? false,
        immobilized: input.immobilized ?? false,
        evidenceKeys: input.evidenceKeys ?? [],
        linkedWorkOrderIds: [],
        followUps: [],
        status: "OPEN",
        createdAt: now,
        updatedAt: now,
      }),
    );
  const created = await getIssueById(docId);
  if (!created) throw new Error("Issue not found after creation");
  void db;
  return created;
}

export async function getIssueById(id: string): Promise<MaintenanceReport | null> {
  const snap = await issuesRef().doc(id).get();
  if (!snap.exists) return null;
  return toIssue(snap.id, snap.data() ?? {});
}

/** List issues, equality-filtered, newest first. */
export async function listIssues(options?: {
  vehicleId?: string;
  reportedBy?: string;
  status?: ReportStatus;
  severity?: string;
  safetyCritical?: boolean;
  limit?: number;
}): Promise<MaintenanceReport[]> {
  let query: import("firebase-admin/firestore").Query = issuesRef();
  if (options?.vehicleId) query = query.where("vehicleId", "==", options.vehicleId);
  if (options?.reportedBy) query = query.where("reportedBy", "==", options.reportedBy);
  if (options?.status) query = query.where("status", "==", options.status);
  if (options?.safetyCritical !== undefined) {
    query = query.where("safetyCritical", "==", options.safetyCritical);
  }
  const snap = await query.limit(2000).get();
  return snap.docs
    .map((doc) => toIssue(doc.id, doc.data()))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, options?.limit ?? 500);
}

/** Record a lifecycle transition (triage/close) with actor + timestamps. */
export async function applyIssueStatus(
  id: string,
  status: ReportStatus,
  actorId: string,
  extra?: { resolution?: string; duplicateOfIssueId?: string; notActionableReason?: string },
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
    if (extra?.resolution) update.resolution = extra.resolution.slice(0, 2000);
    if (extra?.duplicateOfIssueId) update.duplicateOfIssueId = extra.duplicateOfIssueId;
    if (extra?.notActionableReason) {
      update.notActionableReason = extra.notActionableReason.slice(0, 1000);
    }
  }
  await issuesRef().doc(id).update(update);
  const updated = await getIssueById(id);
  if (!updated) throw new Error("Issue not found after status change");
  return updated;
}

/** Add a follow-up comment/evidence without touching the original report. */
export async function addIssueFollowUp(
  id: string,
  followUp: { byUserId: string; text: string; evidenceKeys?: string[] },
): Promise<MaintenanceReport> {
  const { FieldValue } = await import("firebase-admin/firestore");
  await issuesRef()
    .doc(id)
    .update({
      followUps: FieldValue.arrayUnion({
        byUserId: followUp.byUserId,
        text: followUp.text.slice(0, 2000),
        at: new Date(),
        evidenceKeys: followUp.evidenceKeys ?? [],
      }),
      updatedAt: FieldValue.serverTimestamp(),
    });
  const updated = await getIssueById(id);
  if (!updated) throw new Error("Issue not found after follow-up");
  return updated;
}

/** Record triage decisions that change classification (audited by the route). */
export async function reclassifyIssue(
  id: string,
  fields: {
    category?: string;
    severity?: MaintenanceReport["severity"];
    safetyCritical?: boolean;
  },
): Promise<MaintenanceReport> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) update[k] = v;
  }
  await issuesRef().doc(id).update(update);
  const updated = await getIssueById(id);
  if (!updated) throw new Error("Issue not found after reclassification");
  return updated;
}

/** Bidirectional link: issue → work order (and reverse written by WO route). */
export async function linkIssueToWorkOrder(issueId: string, workOrderId: string): Promise<void> {
  const { FieldValue } = await import("firebase-admin/firestore");
  await issuesRef()
    .doc(issueId)
    .update({
      workOrderId,
      linkedWorkOrderIds: FieldValue.arrayUnion(workOrderId),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

/** Comment on an issue on behalf of the reporter or staff. */
export { addIssueFollowUp as appendIssueComment };
