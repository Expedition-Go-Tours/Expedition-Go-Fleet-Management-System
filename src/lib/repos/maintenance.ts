import type { DocumentData } from "firebase-admin/firestore";

import type { ScheduleStatus } from "@/lib/domain/maintenance";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import { toDate } from "@/lib/repos/timestamps";

/*
 * Preventive-maintenance storage: reusable templates, per-vehicle schedules
 * and immutable completed-service records.
 */

/** Strip undefined values — Firestore rejects them as document fields. */
function definedOnly(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
}

/* ------------------------------- Template ------------------------------- */

export interface MaintenanceTemplate {
  id: string;
  name: string;
  category: string;
  intervalKm?: number;
  intervalDays?: number;
  dueSoonKm?: number;
  dueSoonDays?: number;
  /** Vehicle categories this template applies to when auto-suggested. */
  appliesToTypes: string[];
  enabled: boolean;
  /** Where the interval comes from (company policy, manufacturer, …). */
  source?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

function templatesRef() {
  return getAdminDb().collection(COLLECTIONS.maintenanceTemplates);
}

function toTemplate(id: string, data: DocumentData): MaintenanceTemplate {
  return {
    id,
    name: String(data.name ?? ""),
    category: String(data.category ?? "GENERAL"),
    intervalKm: typeof data.intervalKm === "number" ? data.intervalKm : undefined,
    intervalDays: typeof data.intervalDays === "number" ? data.intervalDays : undefined,
    dueSoonKm: typeof data.dueSoonKm === "number" ? data.dueSoonKm : undefined,
    dueSoonDays: typeof data.dueSoonDays === "number" ? data.dueSoonDays : undefined,
    appliesToTypes: Array.isArray(data.appliesToTypes) ? data.appliesToTypes.map(String) : [],
    enabled: data.enabled !== false,
    source: data.source ? String(data.source) : undefined,
    notes: data.notes ? String(data.notes) : undefined,
    createdAt: toDate(data.createdAt) ?? new Date(0),
    updatedAt: toDate(data.updatedAt) ?? new Date(0),
  };
}

export interface CreateTemplateInput {
  name: string;
  category: string;
  intervalKm?: number;
  intervalDays?: number;
  dueSoonKm?: number;
  dueSoonDays?: number;
  appliesToTypes?: string[];
  source?: string;
  notes?: string;
}

export async function createTemplate(input: CreateTemplateInput): Promise<MaintenanceTemplate> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const now = FieldValue.serverTimestamp();
  const doc = await templatesRef().add(
    definedOnly({
      ...input,
      appliesToTypes: input.appliesToTypes ?? [],
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }),
  );
  const created = await getTemplateById(doc.id);
  if (!created) throw new Error("Template not found after creation");
  return created;
}

export async function getTemplateById(id: string): Promise<MaintenanceTemplate | null> {
  const snap = await templatesRef().doc(id).get();
  if (!snap.exists) return null;
  return toTemplate(snap.id, snap.data() ?? {});
}

export async function listTemplates(): Promise<MaintenanceTemplate[]> {
  const snap = await templatesRef().limit(500).get();
  return snap.docs
    .map((d) => toTemplate(d.id, d.data()))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function updateTemplate(
  id: string,
  fields: Partial<CreateTemplateInput> & { enabled?: boolean },
): Promise<MaintenanceTemplate> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const cleaned = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  await templatesRef()
    .doc(id)
    .update({ ...cleaned, updatedAt: FieldValue.serverTimestamp() });
  const updated = await getTemplateById(id);
  if (!updated) throw new Error("Template not found after update");
  return updated;
}

/* ------------------------------- Schedule ------------------------------- */

export interface MaintenanceSchedule {
  id: string;
  vehicleId: string;
  templateId?: string;
  taskName: string;
  category: string;
  intervalKm?: number;
  intervalDays?: number;
  dueSoonKm?: number;
  dueSoonDays?: number;
  /** Authoritative baseline — updated ONLY by recorded service completion. */
  lastServiceOdometerKm?: number;
  lastServiceDate?: Date;
  lastServiceRecordId?: string;
  enabled: boolean;
  source?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

function schedulesRef() {
  return getAdminDb().collection(COLLECTIONS.maintenanceSchedules);
}

function toSchedule(id: string, data: DocumentData): MaintenanceSchedule {
  return {
    id,
    vehicleId: String(data.vehicleId ?? ""),
    templateId: data.templateId ? String(data.templateId) : undefined,
    taskName: String(data.taskName ?? ""),
    category: String(data.category ?? "GENERAL"),
    intervalKm: typeof data.intervalKm === "number" ? data.intervalKm : undefined,
    intervalDays: typeof data.intervalDays === "number" ? data.intervalDays : undefined,
    dueSoonKm: typeof data.dueSoonKm === "number" ? data.dueSoonKm : undefined,
    dueSoonDays: typeof data.dueSoonDays === "number" ? data.dueSoonDays : undefined,
    lastServiceOdometerKm:
      typeof data.lastServiceOdometerKm === "number" ? data.lastServiceOdometerKm : undefined,
    lastServiceDate: toDate(data.lastServiceDate),
    lastServiceRecordId: data.lastServiceRecordId ? String(data.lastServiceRecordId) : undefined,
    enabled: data.enabled !== false,
    source: data.source ? String(data.source) : undefined,
    notes: data.notes ? String(data.notes) : undefined,
    createdAt: toDate(data.createdAt) ?? new Date(0),
    updatedAt: toDate(data.updatedAt) ?? new Date(0),
  };
}

export interface CreateScheduleInput {
  vehicleId: string;
  templateId?: string;
  taskName: string;
  category?: string;
  intervalKm?: number;
  intervalDays?: number;
  dueSoonKm?: number;
  dueSoonDays?: number;
  /** Initial baseline — explicit and audited; without it the task is NOT_CONFIGURED. */
  lastServiceOdometerKm?: number;
  lastServiceDate?: Date;
  source?: string;
  notes?: string;
}

export async function createSchedule(input: CreateScheduleInput): Promise<MaintenanceSchedule> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const now = FieldValue.serverTimestamp();
  const doc = await schedulesRef().add(
    definedOnly({
      ...input,
      category: input.category ?? "GENERAL",
      lastServiceDate: input.lastServiceDate ?? null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }),
  );
  const created = await getScheduleById(doc.id);
  if (!created) throw new Error("Schedule not found after creation");
  return created;
}

export async function getScheduleById(id: string): Promise<MaintenanceSchedule | null> {
  const snap = await schedulesRef().doc(id).get();
  if (!snap.exists) return null;
  return toSchedule(snap.id, snap.data() ?? {});
}

export async function listSchedules(vehicleId: string): Promise<MaintenanceSchedule[]> {
  const snap = await schedulesRef().where("vehicleId", "==", vehicleId).limit(500).get();
  return snap.docs.map((d) => toSchedule(d.id, d.data()));
}

/** All enabled schedules across the fleet (for reminder cron + dashboards). */
export async function listAllSchedules(limit = 2000): Promise<MaintenanceSchedule[]> {
  const snap = await schedulesRef().limit(limit).get();
  return snap.docs.map((d) => toSchedule(d.id, d.data()));
}

export async function updateSchedule(
  id: string,
  fields: Partial<CreateScheduleInput> & { enabled?: boolean },
): Promise<MaintenanceSchedule> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const cleaned = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  await schedulesRef()
    .doc(id)
    .update({ ...cleaned, updatedAt: FieldValue.serverTimestamp() });
  const updated = await getScheduleById(id);
  if (!updated) throw new Error("Schedule not found after update");
  return updated;
}

/* ----------------------------- ServiceRecord ----------------------------- */

export interface ServiceRecord {
  id: string;
  vehicleId: string;
  /** Service task — links back to the schedule that was reset. */
  scheduleId?: string;
  taskName: string;
  workOrderId?: string;
  completedAt: Date;
  odometerKm: number;
  workPerformed: string;
  outcome?: string;
  providerId?: string;
  providerName?: string;
  technicianName?: string;
  notes?: string;
  /** Expense ids for parts/labour — referenced, never copied into totals. */
  expenseIds: string[];
  /** Issue ids this service resolved. */
  resolvedIssueIds: string[];
  recordedByUserId: string;
  createdAt: Date;
  /** Guards duplicate completion: the work order it came from, once. */
  idempotencyKey?: string;
}

function serviceRecordsRef() {
  return getAdminDb().collection(COLLECTIONS.serviceRecords);
}

function toServiceRecord(id: string, data: DocumentData): ServiceRecord {
  return {
    id,
    vehicleId: String(data.vehicleId ?? ""),
    scheduleId: data.scheduleId ? String(data.scheduleId) : undefined,
    taskName: String(data.taskName ?? ""),
    workOrderId: data.workOrderId ? String(data.workOrderId) : undefined,
    completedAt: toDate(data.completedAt) ?? new Date(0),
    odometerKm: Number(data.odometerKm ?? 0),
    workPerformed: String(data.workPerformed ?? ""),
    outcome: data.outcome ? String(data.outcome) : undefined,
    providerId: data.providerId ? String(data.providerId) : undefined,
    providerName: data.providerName ? String(data.providerName) : undefined,
    technicianName: data.technicianName ? String(data.technicianName) : undefined,
    notes: data.notes ? String(data.notes) : undefined,
    expenseIds: Array.isArray(data.expenseIds) ? data.expenseIds.map(String) : [],
    resolvedIssueIds: Array.isArray(data.resolvedIssueIds) ? data.resolvedIssueIds.map(String) : [],
    recordedByUserId: String(data.recordedByUserId ?? ""),
    createdAt: toDate(data.createdAt) ?? new Date(0),
    idempotencyKey: data.idempotencyKey ? String(data.idempotencyKey) : undefined,
  };
}

export async function getServiceRecordById(id: string): Promise<ServiceRecord | null> {
  const snap = await serviceRecordsRef().doc(id).get();
  if (!snap.exists) return null;
  return toServiceRecord(snap.id, snap.data() ?? {});
}

export async function listServiceRecords(vehicleId: string): Promise<ServiceRecord[]> {
  const snap = await serviceRecordsRef().where("vehicleId", "==", vehicleId).limit(1000).get();
  return snap.docs
    .map((d) => toServiceRecord(d.id, d.data()))
    .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
}

export async function findServiceRecordByKey(key: string): Promise<ServiceRecord | null> {
  const snap = await serviceRecordsRef().where("idempotencyKey", "==", key).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0]!;
  return toServiceRecord(doc.id, doc.data());
}

/* ------------------------- Status evaluation view ------------------------- */

export interface ScheduleWithStatus extends MaintenanceSchedule {
  status: ScheduleStatus;
  nextDueOdometerKm: number | null;
  nextDueDate: Date | null;
  remainingKm: number | null;
  remainingDays: number | null;
  computed: boolean;
  note?: string;
}
