import type { DocumentData } from "firebase-admin/firestore";

import type { ScheduleStatus } from "@/lib/domain/maintenance";
import { auditSnapshot, DeletionError, type DeletionAudit } from "@/lib/domain/deletion";
import { serviceExpenseId } from "@/lib/domain/service-cost";
import { writeAuditEventInTx } from "@/lib/repos/audit";
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
  /** Null when recorded without a reading — never fabricated as 0. */
  odometerKm: number | null;
  workPerformed: string;
  outcome?: string;
  providerId?: string;
  providerName?: string;
  technicianName?: string;
  /** Person who received the payment, when the cost was paid to an individual. */
  paidTo?: string;
  notes?: string;
  /** Expense ids for parts/labour — referenced, never copied into totals. */
  expenseIds: string[];
  /**
   * Cost the person completing the service asked to record. Persisted in the
   * same transaction as the service record so a retry can finish the linked
   * expense even if the first request died between the two writes.
   */
  repairCostMinor?: number;
  repairCostCurrency?: string;
  /**
   * Itemised breakdown of the recorded cost, when the caller supplied one.
   * `repairCostMinor` remains the authoritative total (labour + items).
   */
  labourCostMinor?: number;
  costItems?: { name: string; amountMinor: number }[];
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
    odometerKm: typeof data.odometerKm === "number" ? data.odometerKm : null,
    workPerformed: String(data.workPerformed ?? ""),
    outcome: data.outcome ? String(data.outcome) : undefined,
    providerId: data.providerId ? String(data.providerId) : undefined,
    providerName: data.providerName ? String(data.providerName) : undefined,
    technicianName: data.technicianName ? String(data.technicianName) : undefined,
    paidTo: data.paidTo ? String(data.paidTo) : undefined,
    notes: data.notes ? String(data.notes) : undefined,
    expenseIds: Array.isArray(data.expenseIds) ? data.expenseIds.map(String) : [],
    repairCostMinor:
      data.repairCostMinor === undefined || data.repairCostMinor === null
        ? undefined
        : Number(data.repairCostMinor),
    repairCostCurrency: data.repairCostCurrency ? String(data.repairCostCurrency) : undefined,
    labourCostMinor:
      typeof data.labourCostMinor === "number" ? Number(data.labourCostMinor) : undefined,
    costItems: Array.isArray(data.costItems)
      ? data.costItems
          .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
          .map((item) => ({
            name: String(item.name ?? ""),
            amountMinor: Number(item.amountMinor ?? 0),
          }))
          .filter((item) => item.name !== "" && Number.isSafeInteger(item.amountMinor))
      : undefined,
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

/**
 * Link a recorded expense to a service record. Additive only: the work
 * performed stays immutable, and costs are referenced rather than copied so
 * reports count each pesewa once (through the expense).
 */
export async function linkExpenseToServiceRecord(
  serviceRecordId: string,
  expenseId: string,
): Promise<void> {
  const { FieldValue } = await import("firebase-admin/firestore");
  await serviceRecordsRef()
    .doc(serviceRecordId)
    .update({
      expenseIds: FieldValue.arrayUnion(expenseId),
    });
}

export async function listServiceRecords(vehicleId: string): Promise<ServiceRecord[]> {
  const snap = await serviceRecordsRef().where("vehicleId", "==", vehicleId).limit(1000).get();
  return snap.docs
    .map((d) => toServiceRecord(d.id, d.data()))
    .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
}

/**
 * Completed service across the fleet, newest first. The maintenance board only
 * knows schedules — a direct log (or a work-order completion) has no schedule
 * row of its own, so the page lists these records explicitly.
 */
export async function listRecentServiceRecords(limit = 50): Promise<ServiceRecord[]> {
  const snap = await serviceRecordsRef().limit(1000).get();
  return snap.docs
    .map((d) => toServiceRecord(d.id, d.data()))
    .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())
    .slice(0, limit);
}

export async function findServiceRecordByKey(key: string): Promise<ServiceRecord | null> {
  const snap = await serviceRecordsRef().where("idempotencyKey", "==", key).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0]!;
  return toServiceRecord(doc.id, doc.data());
}

export interface DeleteServiceRecordResult {
  before: ServiceRecord;
  deletedExpenseIds: string[];
  /** Schedules whose baseline was cleared because this record set it. */
  clearedScheduleIds: string[];
  /** Odometer observations kept as mileage history, with the link cleared. */
  unlinkedOdometerReadingIds: string[];
  /** Work order left untouched except for its service-record link. */
  unlinkedWorkOrderId?: string;
}

/**
 * Permanently delete one completed service record (ADMIN only, with a reason).
 *
 * The linked MAINTENANCE expense(s) are removed with it. Schedules this record
 * last reset lose their baseline rather than keeping a due point derived from a
 * record that no longer exists; they return to NOT_CONFIGURED until the next
 * service is recorded. Odometer readings are kept as mileage history and only
 * lose their service link. A linked work order is kept — deletion removes the
 * service record, not the workshop's record of the job — and its link is cleared.
 */
export async function deleteServiceRecord(
  id: string,
  audit?: DeletionAudit,
): Promise<DeleteServiceRecordResult> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const db = getAdminDb();
  const recordRef = serviceRecordsRef().doc(id);

  const before = await getServiceRecordById(id);
  if (!before) {
    throw new DeletionError("SERVICE_NOT_FOUND", "Service record not found");
  }

  const scheduleSnap = await db
    .collection(COLLECTIONS.maintenanceSchedules)
    .where("lastServiceRecordId", "==", id)
    .limit(100)
    .get();
  const scheduleRefs = scheduleSnap.docs.map((doc) => doc.ref);

  const readingSnap = await db
    .collection(COLLECTIONS.odometerReadings)
    .where("serviceRecordId", "==", id)
    .limit(50)
    .get();
  const readingRefs = readingSnap.docs.map((doc) => doc.ref);

  const linkedExpenseSnap = await db
    .collection(COLLECTIONS.expenses)
    .where("serviceRecordId", "==", id)
    .limit(20)
    .get();
  const expenseIds = new Set<string>([
    // Include the deterministic id so an orphaned expense from a partial
    // earlier write cannot survive the service record.
    serviceExpenseId(id),
    ...before.expenseIds,
    ...linkedExpenseSnap.docs.map((doc) => doc.id),
  ]);
  const expenseRefs = [...expenseIds].map((expenseId) =>
    db.collection(COLLECTIONS.expenses).doc(expenseId),
  );

  const workOrderRef = before.workOrderId
    ? db.collection(COLLECTIONS.workOrders).doc(before.workOrderId)
    : null;

  const now = FieldValue.serverTimestamp();

  return db.runTransaction(async (tx) => {
    const recordSnap = await tx.get(recordRef);
    if (!recordSnap.exists) {
      throw new DeletionError("SERVICE_NOT_FOUND", "Service record not found");
    }

    const scheduleSnaps = await Promise.all(scheduleRefs.map((ref) => tx.get(ref)));
    const readingSnaps = await Promise.all(readingRefs.map((ref) => tx.get(ref)));
    const expenseSnaps = await Promise.all(expenseRefs.map((ref) => tx.get(ref)));
    const workOrderSnap = workOrderRef ? await tx.get(workOrderRef) : null;

    const deletedExpenseIds: string[] = [];
    const deletedExpenses: unknown[] = [];
    for (const expenseSnap of expenseSnaps) {
      if (!expenseSnap.exists) continue;
      deletedExpenses.push(auditSnapshot({ id: expenseSnap.id, ...expenseSnap.data() }));
      tx.delete(expenseSnap.ref);
      deletedExpenseIds.push(expenseSnap.id);
    }

    const clearedScheduleIds: string[] = [];
    for (const scheduleSnap of scheduleSnaps) {
      if (!scheduleSnap.exists) continue;
      if (String(scheduleSnap.data()?.lastServiceRecordId ?? "") !== id) continue;
      tx.update(scheduleSnap.ref, {
        lastServiceRecordId: null,
        lastServiceDate: null,
        lastServiceOdometerKm: null,
        updatedAt: now,
      });
      clearedScheduleIds.push(scheduleSnap.id);
    }

    const unlinkedOdometerReadingIds: string[] = [];
    for (const readingSnap of readingSnaps) {
      if (!readingSnap.exists) continue;
      if (String(readingSnap.data()?.serviceRecordId ?? "") !== id) continue;
      tx.update(readingSnap.ref, { serviceRecordId: null });
      unlinkedOdometerReadingIds.push(readingSnap.id);
    }

    let unlinkedWorkOrderId: string | undefined;
    if (
      workOrderRef &&
      workOrderSnap?.exists &&
      String(workOrderSnap.data()?.serviceRecordId ?? "") === id
    ) {
      tx.update(workOrderRef, { serviceRecordId: null, updatedAt: now });
      unlinkedWorkOrderId = workOrderRef.id;
    }

    if (audit) {
      writeAuditEventInTx(tx, {
        ...audit,
        before: auditSnapshot(before),
        after: {
          deletedExpenseIds,
          deletedExpenses,
          clearedScheduleIds,
          unlinkedOdometerReadingIds,
          unlinkedWorkOrderId: unlinkedWorkOrderId ?? null,
        },
      });
    }

    tx.delete(recordRef);

    return {
      before,
      deletedExpenseIds,
      clearedScheduleIds,
      unlinkedOdometerReadingIds,
      unlinkedWorkOrderId,
    };
  });
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
