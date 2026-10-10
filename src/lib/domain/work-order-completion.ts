import { COMPLETABLE_STATUSES } from "@/lib/domain/work-order";
import type { ServiceRecord } from "@/lib/repos/maintenance";

/*
 * Work-order completion workflow (Phase C core).
 *
 * The completion is idempotent per work order: a replayed request finds the
 * existing service record and returns it. The ServiceRecord, schedule baseline
 * resets (only the schedules named), issue resolution and the work-order
 * state are written in ONE Firestore transaction — they cannot disagree.
 * The completion odometer reading is recorded through the ledger's own
 * transaction immediately afterwards.
 */

export class CompletionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CompletionError";
    this.code = code;
  }
}

export interface CompleteWorkOrderInput {
  workOrderId: string;
  /** Actual completion date/time. */
  completedAt: Date;
  /** Odometer at completion — validated against the ledger policy. */
  odometerKm: number;
  workPerformed: string;
  outcome?: string;
  providerId?: string;
  providerName?: string;
  technicianName?: string;
  notes?: string;
  /** Schedule ids whose baselines this work resets (PM tasks actually done). */
  scheduleIds: string[];
  /** Issue ids this work resolves. */
  resolvedIssueIds: string[];
  recordedByUserId: string;
}

export interface CompleteWorkOrderResult {
  serviceRecord: ServiceRecord;
  /** True when a replay found the existing record (idempotent no-op). */
  duplicate: boolean;
  /** Schedule ids whose baselines were reset by this completion. */
  resetScheduleIds: string[];
}

/** A requested issue, as loaded from the authoritative store. */
export interface FetchedIssue {
  id: string;
  exists: boolean;
  vehicleId?: string;
  status?: string;
}

/**
 * Pure issue-link validation, extracted so it can be unit-tested without
 * Firestore. Given the authoritative work-order relationship (`linkedIssueIds`)
 * and the issues actually fetched from the store, it returns the ids that may
 * transition to CLOSED. Anything unrelated, missing, on another vehicle,
 * duplicated or already closed is rejected/skipped — an issue is never closed
 * merely because the request named it.
 */
export function planIssueClosure(input: {
  workOrderId: string;
  vehicleId: string;
  linkedIssueIds: string[];
  requestedIssueIds: string[];
  fetched: FetchedIssue[];
}): string[] {
  if (new Set(input.requestedIssueIds).size !== input.requestedIssueIds.length) {
    throw new CompletionError("DUPLICATE_ISSUE", "Duplicate ids in resolvedIssueIds");
  }
  const toClose: string[] = [];
  for (const issueId of input.requestedIssueIds) {
    if (!input.linkedIssueIds.includes(issueId)) {
      throw new CompletionError(
        "UNRELATED_ISSUE",
        `Issue ${issueId} is not linked to work order ${input.workOrderId}`,
      );
    }
    const issue = input.fetched.find((f) => f.id === issueId);
    if (!issue || !issue.exists) {
      throw new CompletionError("ISSUE_NOT_FOUND", `Issue ${issueId} not found`);
    }
    if (String(issue.vehicleId ?? "") !== input.vehicleId) {
      throw new CompletionError(
        "ISSUE_VEHICLE_MISMATCH",
        `Issue ${issueId} does not belong to vehicle ${input.vehicleId}`,
      );
    }
    // Only OPEN/TRIAGED issues may transition to CLOSED; an already-closed
    // issue is left untouched so a retry cannot overwrite its resolution.
    if (String(issue.status ?? "") !== "CLOSED") toClose.push(issueId);
  }
  return toClose;
}

export async function completeWorkOrder(
  input: CompleteWorkOrderInput,
): Promise<CompleteWorkOrderResult> {
  const { COLLECTIONS } = await import("@/lib/db/collections");
  const { getAdminDb } = await import("@/lib/firebase/admin");
  const { validateReading } = await import("@/lib/domain/odometer");
  const { findServiceRecordByKey } = await import("@/lib/repos/maintenance");
  const { recordReading } = await import("@/lib/repos/odometers");

  const db = getAdminDb();
  const workOrderRef = db.collection(COLLECTIONS.workOrders).doc(input.workOrderId);
  const idempotencyKey = `wo:${input.workOrderId}`;

  const woSnap = await workOrderRef.get();
  if (!woSnap.exists) throw new CompletionError("NOT_FOUND", "Work order not found");
  const wo = woSnap.data() ?? {};
  const vehicleId = String(wo.vehicleId ?? "");
  if (!vehicleId) throw new CompletionError("NO_VEHICLE", "Work order has no vehicle");

  // Idempotency: a completed work order with an existing service record means
  // this request is a replay.
  if (["COMPLETED", "VERIFIED", "CLOSED"].includes(String(wo.status))) {
    const existing = await findServiceRecordByKey(idempotencyKey);
    if (existing) {
      // Heal records completed before the ledger write became transactional:
      // recording with the same client token is a no-op if the reading exists,
      // and closes the gap if a crash lost it. Failure is logged (detectable),
      // not silently swallowed, and does not fail the replay.
      await recordReading({
        vehicleId: existing.vehicleId,
        km: existing.odometerKm,
        source: "SERVICE_COMPLETION",
        recordedByUserId: input.recordedByUserId,
        effectiveAt: existing.completedAt,
        serviceRecordId: existing.id,
        notes: `Completion of work order — ${existing.workPerformed.slice(0, 200)}`,
        clientToken: `svc-${input.workOrderId}`,
      }).catch((error: unknown) => {
        console.error(
          "[work-order-completion] replay odometer heal failed",
          input.workOrderId,
          error,
        );
      });
      return { serviceRecord: existing, duplicate: true, resetScheduleIds: input.scheduleIds };
    }
    throw new CompletionError("ALREADY_COMPLETE", `Work order is already ${String(wo.status)}`);
  }
  if (!(COMPLETABLE_STATUSES as readonly string[]).includes(String(wo.status))) {
    throw new CompletionError(
      "INVALID_STATE",
      `Work order is ${String(wo.status)}; it can only be completed from ${COMPLETABLE_STATUSES.join("/")}`,
    );
  }

  // Validate the completion odometer against the current projection before
  // entering the transaction, so failures are clean 4xx responses.
  const vehicleSnap = await db.collection(COLLECTIONS.vehicles).doc(vehicleId).get();
  if (!vehicleSnap.exists) throw new CompletionError("VEHICLE_NOT_FOUND", "Vehicle not found");
  const projection = Number(vehicleSnap.data()?.odometerKm ?? 0);
  const validation = validateReading(input.odometerKm, "SERVICE_COMPLETION", projection);
  if (!validation.ok) {
    throw new CompletionError(validation.code, validation.message);
  }

  // --- Issue-link integrity --------------------------------------------------
  // An issue is never closed merely because the request named it. Every
  // requested id must (a) be linked to THIS work order on the authoritative
  // record and (b) belong to THIS vehicle. Anything else is rejected before a
  // single write happens, so an invalid request cannot partially close records.
  const requestedIssueIds = input.resolvedIssueIds;
  const linkedIssueIds = Array.isArray(wo.issueIds) ? wo.issueIds.map(String) : [];
  const issuesRef = db.collection(COLLECTIONS.maintenanceReports);

  // Reject unrelated ids before reading anything else.
  for (const issueId of requestedIssueIds) {
    if (!linkedIssueIds.includes(issueId)) {
      throw new CompletionError(
        "UNRELATED_ISSUE",
        `Issue ${issueId} is not linked to work order ${input.workOrderId}`,
      );
    }
  }

  const fetched: FetchedIssue[] = await Promise.all(
    requestedIssueIds.map(async (issueId) => {
      const snap = await issuesRef.doc(issueId).get();
      return snap.exists
        ? {
            id: snap.id,
            exists: true,
            vehicleId: String(snap.data()?.vehicleId ?? ""),
            status: String(snap.data()?.status ?? ""),
          }
        : { id: issueId, exists: false };
    }),
  );

  // Authoritative relationship + lifecycle validation (pure, unit-tested).
  const issuesToClose = planIssueClosure({
    workOrderId: input.workOrderId,
    vehicleId,
    linkedIssueIds,
    requestedIssueIds,
    fetched,
  });

  const serviceRecordsRef = db.collection(COLLECTIONS.serviceRecords);
  const serviceRecordId = serviceRecordsRef.doc().id;
  const now = new Date();

  const serviceRecord: ServiceRecord = {
    id: serviceRecordId,
    vehicleId,
    scheduleId: input.scheduleIds[0],
    taskName: String(wo.title ?? "Work order completion"),
    workOrderId: input.workOrderId,
    completedAt: input.completedAt,
    odometerKm: input.odometerKm,
    workPerformed: input.workPerformed,
    outcome: input.outcome,
    providerId: input.providerId,
    providerName: input.providerName,
    technicianName: input.technicianName,
    notes: input.notes,
    expenseIds: [],
    resolvedIssueIds: input.resolvedIssueIds,
    recordedByUserId: input.recordedByUserId,
    createdAt: now,
    idempotencyKey,
  };

  // Firestore rejects undefined field values — strip them before writing.
  const definedOnly = (data: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));

  // All reads before all writes, per Firestore transaction rules.
  await db.runTransaction(async (tx) => {
    tx.set(serviceRecordsRef.doc(serviceRecordId), definedOnly({ ...serviceRecord }));

    tx.update(workOrderRef, {
      status: "COMPLETED",
      completedAt: input.completedAt,
      completionOdometerKm: input.odometerKm,
      workPerformed: input.workPerformed,
      outcome: input.outcome ?? null,
      completedByUserId: input.recordedByUserId,
      serviceRecordId,
      updatedAt: now,
    });

    for (const scheduleId of input.scheduleIds) {
      tx.update(db.collection(COLLECTIONS.maintenanceSchedules).doc(scheduleId), {
        lastServiceOdometerKm: input.odometerKm,
        lastServiceDate: input.completedAt,
        lastServiceRecordId: serviceRecordId,
        updatedAt: now,
      });
    }

    for (const issueId of issuesToClose) {
      tx.update(db.collection(COLLECTIONS.maintenanceReports).doc(issueId), {
        status: "CLOSED",
        resolvedByWorkOrderId: input.workOrderId,
        resolvedAt: input.completedAt,
        resolution: input.workPerformed.slice(0, 2000),
        updatedAt: now,
      });
    }

    // Completion odometer: the ledger entry and the current-odometer projection
    // are written in the SAME transaction as the service record, so a completed
    // service can never be left without its odometer event. The reading id
    // matches what recordReading() would derive from the client token, so a
    // replay is a no-op.
    const readingId = `${vehicleId}_svc-${input.workOrderId}`;
    tx.set(db.collection(COLLECTIONS.odometerReadings).doc(readingId), {
      vehicleId,
      km: input.odometerKm,
      effectiveAt: input.completedAt,
      createdAt: now,
      recordedByUserId: input.recordedByUserId,
      source: "SERVICE_COMPLETION",
      serviceRecordId,
      notes: `Completion of work order — ${input.workPerformed.slice(0, 200)}`,
      status: "ACCEPTED",
      deltaKm: input.odometerKm - projection,
      clientToken: `svc-${input.workOrderId}`,
    });
    if (input.odometerKm > projection) {
      tx.update(db.collection(COLLECTIONS.vehicles).doc(vehicleId), {
        odometerKm: input.odometerKm,
        odometerAt: input.completedAt,
        odometerSource: "SERVICE_COMPLETION",
        updatedAt: now,
      });
    }
  });

  return { serviceRecord, duplicate: false, resetScheduleIds: input.scheduleIds };
}
