import type { DocumentData } from "firebase-admin/firestore";

import { COLLECTIONS } from "@/lib/db/collections";
import type { IncidentReport, IncidentStatus, IncidentType } from "@/lib/domain/incident";
import { INCIDENT_STATUSES, INCIDENT_TYPES } from "@/lib/domain/incident";
import { getAdminDb } from "@/lib/firebase/admin";
import { toDate } from "@/lib/repos/timestamps";

/** Firestore-backed incident report repository. */

function incidentsRef() {
  return getAdminDb().collection(COLLECTIONS.incidentReports);
}

const KNOWN_TYPES = INCIDENT_TYPES as readonly string[];
const KNOWN_STATUSES = INCIDENT_STATUSES as readonly string[];

function toIncident(id: string, data: DocumentData): IncidentReport {
  return {
    id,
    vehicleId: String(data.vehicleId ?? ""),
    type: KNOWN_TYPES.includes(String(data.type)) ? (data.type as IncidentType) : "OTHER",
    occurredAt: toDate(data.occurredAt) ?? new Date(),
    location: data.location ? String(data.location) : undefined,
    description: String(data.description ?? ""),
    severity: String(data.severity ?? "MEDIUM"),
    reportedByUserId: String(data.reportedByUserId ?? ""),
    status: KNOWN_STATUSES.includes(String(data.status)) ? (data.status as IncidentStatus) : "OPEN",
    resolution: data.resolution ? String(data.resolution) : undefined,
    resolvedByUserId: data.resolvedByUserId ? String(data.resolvedByUserId) : undefined,
    resolvedAt: toDate(data.resolvedAt),
    createdAt: toDate(data.createdAt) ?? new Date(0),
    updatedAt: toDate(data.updatedAt) ?? new Date(0),
  };
}

export interface CreateIncidentInput {
  vehicleId: string;
  type: IncidentType;
  occurredAt: Date;
  location?: string;
  description: string;
  severity: string;
  reportedByUserId: string;
}

export async function createIncident(input: CreateIncidentInput): Promise<IncidentReport> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const docRef = incidentsRef().doc();
  const now = FieldValue.serverTimestamp();
  await docRef.set({
    vehicleId: input.vehicleId,
    type: input.type,
    occurredAt: input.occurredAt,
    location: input.location ?? null,
    description: input.description.slice(0, 4000),
    severity: input.severity,
    reportedByUserId: input.reportedByUserId,
    status: "OPEN",
    createdAt: now,
    updatedAt: now,
  });
  const created = (await docRef.get()).data() ?? {};
  return toIncident(docRef.id, created);
}

export async function getIncidentById(id: string): Promise<IncidentReport | null> {
  const snap = await incidentsRef().doc(id).get();
  if (!snap.exists) return null;
  return toIncident(snap.id, snap.data() ?? {});
}

export async function listIncidents(options?: {
  vehicleId?: string;
  reportedBy?: string;
  limit?: number;
}): Promise<IncidentReport[]> {
  let query: import("firebase-admin/firestore").Query = incidentsRef();
  if (options?.vehicleId) query = query.where("vehicleId", "==", options.vehicleId);
  if (options?.reportedBy) query = query.where("reportedByUserId", "==", options.reportedBy);
  const snap = await query.limit(2000).get();
  return snap.docs
    .map((d) => toIncident(d.id, d.data()))
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, options?.limit ?? 100);
}

/** Count incidents matching the same equality filters as `listIncidents`. */
export async function countIncidents(options?: {
  vehicleId?: string;
  reportedBy?: string;
}): Promise<number> {
  let query: import("firebase-admin/firestore").Query = incidentsRef();
  if (options?.vehicleId) query = query.where("vehicleId", "==", options.vehicleId);
  if (options?.reportedBy) query = query.where("reportedByUserId", "==", options.reportedBy);
  const snap = await query.count().get();
  return snap.data().count;
}

/**
 * Transition an incident's status (restricted to incident:manage). Resolving
 * requires a resolution note. Records who resolved it and when.
 */
export async function applyIncidentStatus(
  id: string,
  status: IncidentStatus,
  actorId: string,
  extra?: { resolution?: string },
): Promise<IncidentReport> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const update: Record<string, unknown> = {
    status,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (status === "UNDER_REVIEW") {
    update.underReviewSince = FieldValue.serverTimestamp();
    update.underReviewByUserId = actorId;
  }
  if (status === "RESOLVED") {
    update.resolution = extra?.resolution ?? null;
    update.resolvedByUserId = actorId;
    update.resolvedAt = FieldValue.serverTimestamp();
  }
  await incidentsRef().doc(id).update(update);
  const updated = (await incidentsRef().doc(id).get()).data() ?? {};
  return toIncident(id, updated);
}
