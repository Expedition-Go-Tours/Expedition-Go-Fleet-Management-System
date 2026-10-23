import type { ServiceCostItem } from "@/lib/domain/service-cost";
import type { ServiceRecord } from "@/lib/repos/maintenance";
import { toDate } from "@/lib/repos/timestamps";

/*
 * Correct a completed service record.
 *
 * The story of what was done and what it cost can be fixed without rewriting
 * the mileage ledger: the vehicle and odometer are immutable here, while the
 * date, work, provider, payee, notes and the cost breakdown are editable.
 * A date correction also moves the baselines of the schedules this record last
 * reset (only those still pointing at it) and the date of its linked expense,
 * so the maintenance board and the money ledger stay in agreement.
 */

export class ServiceCorrectionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ServiceCorrectionError";
    this.code = code;
  }
}

export interface ServiceCorrectionCost {
  amountMinor: number;
  currency: string;
  labourMinor?: number;
  items?: ServiceCostItem[];
}

export interface CorrectServiceInput {
  serviceRecordId: string;
  completedAt: Date;
  taskName: string;
  workPerformed: string;
  providerName?: string;
  technicianName?: string;
  paidTo?: string;
  notes?: string;
  /** Null only when the record had no cost and none is being added. */
  repairCost: ServiceCorrectionCost | null;
  /** Acting user, used if a cost has to be created for the first time. */
  actorId: string;
}

export interface CorrectServiceResult {
  before: ServiceRecord;
  after: ServiceRecord;
  expenseId?: string;
  expenseCreated: boolean;
}

export async function correctServiceRecord(
  input: CorrectServiceInput,
): Promise<CorrectServiceResult> {
  const { COLLECTIONS } = await import("@/lib/db/collections");
  const { getAdminDb } = await import("@/lib/firebase/admin");
  const { getServiceRecordById, linkExpenseToServiceRecord } = await import(
    "@/lib/repos/maintenance"
  );
  const { ensureServiceExpense, findExpenseByServiceRecordId } = await import(
    "@/lib/repos/expenses"
  );
  const { serviceExpenseId } = await import("@/lib/domain/service-cost");
  const { FieldValue } = await import("firebase-admin/firestore");

  const db = getAdminDb();
  const recordRef = db.collection(COLLECTIONS.serviceRecords).doc(input.serviceRecordId);

  const before = await getServiceRecordById(input.serviceRecordId);
  if (!before) {
    throw new ServiceCorrectionError("SERVICE_NOT_FOUND", "Service record not found");
  }

  // Schedules this record last reset. A later service moves the pointer, so
  // only schedules still pointing here are corrected.
  const scheduleSnap = await db
    .collection(COLLECTIONS.maintenanceSchedules)
    .where("lastServiceRecordId", "==", input.serviceRecordId)
    .limit(50)
    .get();
  const scheduleRefs = scheduleSnap.docs.map((doc) => doc.ref);

  // The reading written with this service (if any) keeps its km; only its
  // effective date follows the corrected completion date.
  const readingSnap = await db
    .collection(COLLECTIONS.odometerReadings)
    .where("serviceRecordId", "==", input.serviceRecordId)
    .limit(10)
    .get();
  const readingDoc = readingSnap.docs.find((doc) => doc.data().status === "ACCEPTED") ?? null;

  const foundExpense = await findExpenseByServiceRecordId(input.serviceRecordId);
  const existingExpenseId = foundExpense?.id ?? before.expenseIds[0];

  let expenseExists = false;
  const now = FieldValue.serverTimestamp();
  await db.runTransaction(async (tx) => {
    const recordSnap = await tx.get(recordRef);
    if (!recordSnap.exists) {
      throw new ServiceCorrectionError("SERVICE_NOT_FOUND", "Service record not found");
    }
    const current = recordSnap.data() ?? {};
    const currentTotal = Number(current.repairCostMinor ?? 0);
    if (currentTotal > 0 && !input.repairCost) {
      throw new ServiceCorrectionError(
        "COST_REQUIRED",
        "This service already has a recorded cost. Enter a positive amount; void the expense to reverse it.",
      );
    }

    // Firestore transactions require all reads before the first write.
    const expenseRef = existingExpenseId
      ? db.collection(COLLECTIONS.expenses).doc(existingExpenseId)
      : null;
    const expenseSnap = expenseRef ? await tx.get(expenseRef) : null;
    expenseExists = Boolean(expenseSnap?.exists);

    const scheduleSnaps = await Promise.all(scheduleRefs.map((ref) => tx.get(ref)));

    const readingRef = readingDoc?.ref ?? null;
    const readingDocSnap = readingRef ? await tx.get(readingRef) : null;
    const vehicleId = String(current.vehicleId ?? "");
    const vehicleRef =
      readingDoc && vehicleId ? db.collection(COLLECTIONS.vehicles).doc(vehicleId) : null;
    const vehicleSnap = vehicleRef ? await tx.get(vehicleRef) : null;

    const workOrderRef = before.workOrderId
      ? db.collection(COLLECTIONS.workOrders).doc(before.workOrderId)
      : null;
    const workOrderSnap = workOrderRef ? await tx.get(workOrderRef) : null;

    tx.update(recordRef, {
      taskName: input.taskName,
      completedAt: input.completedAt,
      workPerformed: input.workPerformed,
      providerName: input.providerName ?? null,
      technicianName: input.technicianName ?? null,
      paidTo: input.paidTo ?? null,
      notes: input.notes ?? null,
      repairCostMinor: input.repairCost?.amountMinor ?? null,
      repairCostCurrency: input.repairCost?.currency ?? null,
      labourCostMinor: input.repairCost?.labourMinor ?? null,
      costItems: input.repairCost?.items ?? null,
      updatedAt: now,
    });

    // A schedule keeps its km baseline (the odometer is immutable here) but
    // follows the corrected service date.
    for (const scheduleSnap of scheduleSnaps) {
      if (!scheduleSnap.exists) continue;
      if (String(scheduleSnap.data()?.lastServiceRecordId ?? "") !== input.serviceRecordId) continue;
      tx.update(scheduleSnap.ref, { lastServiceDate: input.completedAt, updatedAt: now });
    }

    if (expenseRef && expenseSnap?.exists && input.repairCost) {
      tx.update(expenseRef, {
        amountMinor: input.repairCost.amountMinor,
        currency: input.repairCost.currency,
        description: input.workPerformed.slice(0, 200),
        supplierName: input.providerName ?? null,
        paidTo: input.paidTo ?? null,
        incurredOn: input.completedAt,
        updatedAt: now,
      });
    }

    // A work-order completion is the same work seen from the workshop side:
    // keep its completion narrative and date aligned with the corrected record.
    if (
      workOrderRef &&
      workOrderSnap?.exists &&
      String(workOrderSnap.data()?.serviceRecordId ?? "") === input.serviceRecordId
    ) {
      tx.update(workOrderRef, {
        completedAt: input.completedAt,
        workPerformed: input.workPerformed,
        providerName: input.providerName ?? null,
        updatedAt: now,
      });
    }

    if (readingDocSnap?.exists && readingDocSnap.data()?.status === "ACCEPTED") {
      const reading = readingDocSnap.data() ?? {};
      tx.update(readingDocSnap.ref, {
        effectiveAt: input.completedAt,
        notes: `Service log — ${input.workPerformed.slice(0, 200)}`,
      });

      // Keep "last reading at" aligned only when this reading is the current
      // projection — never move the vehicle's km or another reading's date.
      const vehicle = vehicleSnap?.data() ?? {};
      const vehicleKm = Number(vehicle.odometerKm ?? -1);
      const readingKm = Number(reading.km ?? -2);
      const vehicleAt = toDate(vehicle.odometerAt);
      const readingAt = toDate(reading.effectiveAt);
      if (
        vehicleKm === readingKm &&
        vehicleAt &&
        readingAt &&
        Math.abs(vehicleAt.getTime() - readingAt.getTime()) < 1000
      ) {
        tx.update(vehicleRef!, { odometerAt: input.completedAt, updatedAt: now });
      }
    }
  });

  let expenseId: string | undefined = expenseExists ? existingExpenseId : undefined;
  let expenseCreated = false;

  // A cost added after the fact gets the same deterministic expense id as a
  // cost recorded at creation time, so a retry converges instead of duplicating.
  if (input.repairCost && (!existingExpenseId || !expenseExists)) {
    try {
      const ensured = await ensureServiceExpense({
        id: existingExpenseId ?? serviceExpenseId(input.serviceRecordId),
        vehicleId: before.vehicleId,
        workOrderId: before.workOrderId,
        serviceRecordId: input.serviceRecordId,
        category: "MAINTENANCE",
        amountMinor: input.repairCost.amountMinor,
        currency: input.repairCost.currency,
        description: input.workPerformed.slice(0, 200),
        supplierName: input.providerName,
        paidTo: input.paidTo,
        incurredOn: input.completedAt,
        createdBy: input.actorId,
      });
      await linkExpenseToServiceRecord(input.serviceRecordId, ensured.expense.id);
      expenseId = ensured.expense.id;
      expenseCreated = ensured.created;
    } catch {
      throw new ServiceCorrectionError(
        "COST_NOT_RECORDED",
        "The service was corrected, but its cost could not be saved. Submit again to finish the cost — the service will not be duplicated.",
      );
    }
  } else if (existingExpenseId && expenseExists && !before.expenseIds.includes(existingExpenseId)) {
    // Heal an expense that exists but was never linked (a failed earlier write).
    await linkExpenseToServiceRecord(input.serviceRecordId, existingExpenseId);
  }

  const expenseIds = expenseId
    ? before.expenseIds.includes(expenseId)
      ? before.expenseIds
      : [...before.expenseIds, expenseId]
    : before.expenseIds.filter((id) => id !== existingExpenseId);

  return {
    before,
    after: {
      ...before,
      taskName: input.taskName,
      completedAt: input.completedAt,
      workPerformed: input.workPerformed,
      providerName: input.providerName,
      technicianName: input.technicianName,
      paidTo: input.paidTo,
      notes: input.notes,
      repairCostMinor: input.repairCost?.amountMinor,
      repairCostCurrency: input.repairCost?.currency,
      labourCostMinor: input.repairCost?.labourMinor,
      costItems: input.repairCost?.items,
      expenseIds,
    },
    expenseId,
    expenseCreated,
  };
}
