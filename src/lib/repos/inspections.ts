import type { DocumentData } from "firebase-admin/firestore";

import type { Inspection, InspectionItem } from "@/lib/domain/inspection";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import { toDate } from "@/lib/repos/timestamps";

/** Firestore-backed inspection repository. */

function inspectionsRef() {
  return getAdminDb().collection(COLLECTIONS.inspections);
}

function toInspection(id: string, data: DocumentData): Inspection {
  return {
    id,
    vehicleId: String(data.vehicleId ?? ""),
    inspectorUserId: String(data.inspectorUserId ?? ""),
    type: (data.type ?? "PRE_TRIP") as Inspection["type"],
    assignmentId: data.assignmentId ? String(data.assignmentId) : undefined,
    odometerKm: Number(data.odometerKm ?? 0),
    odometerReadingId: data.odometerReadingId ? String(data.odometerReadingId) : undefined,
    items: Array.isArray(data.items)
      ? data.items.map((i: DocumentData): InspectionItem => ({
          key: String(i.key ?? ""),
          label: String(i.label ?? ""),
          critical: i.critical === true,
          result: (i.result ?? "PASS") as InspectionItem["result"],
          notes: i.notes ? String(i.notes) : undefined,
          evidenceKeys: Array.isArray(i.evidenceKeys) ? i.evidenceKeys.map(String) : [],
        }))
      : [],
    overall: (data.overall ?? "PASS") as Inspection["overall"],
    issueIds: Array.isArray(data.issueIds) ? data.issueIds.map(String) : [],
    submittedAt: toDate(data.submittedAt) ?? new Date(0),
    createdAt: toDate(data.createdAt) ?? new Date(0),
  };
}

export interface SubmitInspectionInput {
  vehicleId: string;
  inspectorUserId: string;
  type: Inspection["type"];
  assignmentId?: string;
  odometerKm: number;
  odometerReadingId?: string;
  items: InspectionItem[];
  overall: Inspection["overall"];
  issueIds: string[];
  /** Idempotency: retries reuse the caller's token → same inspection. */
  clientToken?: string;
}

export async function submitInspection(input: SubmitInspectionInput): Promise<Inspection> {
  const docId = input.clientToken
    ? inspectionsRef().doc(`${input.vehicleId}_${input.clientToken}`).id
    : inspectionsRef().doc().id;

  const existing = await inspectionsRef().doc(docId).get();
  if (existing.exists) return toInspection(existing.id, existing.data() ?? {});

  const now = new Date();
  await inspectionsRef()
    .doc(docId)
    .set({
      vehicleId: input.vehicleId,
      inspectorUserId: input.inspectorUserId,
      type: input.type,
      assignmentId: input.assignmentId ?? null,
      odometerKm: input.odometerKm,
      odometerReadingId: input.odometerReadingId ?? null,
      items: input.items,
      overall: input.overall,
      issueIds: input.issueIds,
      submittedAt: now,
      createdAt: now,
    });
  const created = await getInspectionById(docId);
  if (!created) throw new Error("Inspection not found after creation");
  return created;
}

export async function getInspectionById(id: string): Promise<Inspection | null> {
  const snap = await inspectionsRef().doc(id).get();
  if (!snap.exists) return null;
  return toInspection(snap.id, snap.data() ?? {});
}

export async function listInspections(options?: {
  vehicleId?: string;
  inspectorUserId?: string;
  limit?: number;
}): Promise<Inspection[]> {
  let query: import("firebase-admin/firestore").Query = inspectionsRef();
  if (options?.vehicleId) query = query.where("vehicleId", "==", options.vehicleId);
  if (options?.inspectorUserId) {
    query = query.where("inspectorUserId", "==", options.inspectorUserId);
  }
  const snap = await query.limit(2000).get();
  return snap.docs
    .map((d) => toInspection(d.id, d.data()))
    .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
    .slice(0, options?.limit ?? 100);
}
