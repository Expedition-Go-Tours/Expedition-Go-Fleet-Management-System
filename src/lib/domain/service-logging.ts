import type { ServiceCostItem } from "@/lib/domain/service-cost";
import type { ServiceRecord } from "@/lib/repos/maintenance";

/*
 * Direct service logging — recording maintenance that already happened
 * (an ad-hoc garage visit, a breakdown repair) without the ceremony of a
 * work order. Produces the SAME ServiceRecord shape, schedule-baseline reset
 * and — when the caller supplied a reading — the same odometer ledger entry as
 * work-order completion, so service history, maintenance alerts and cost
 * reports never care which door it came through.
 *
 * The odometer is optional for a direct log. When it is absent no reading is
 * invented: the service record keeps its mileage unknown, no ledger entry is
 * written, and the schedule baseline falls back to the last accepted reading.
 *
 * A direct log never touches issues or work orders: it records what was
 * done to the vehicle, nothing else.
 */

export class ServiceLogError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ServiceLogError";
    this.code = code;
  }
}

export interface LogServiceInput {
  vehicleId: string;
  /** Short label for history views, e.g. "Oil & filter change". */
  taskName?: string;
  /** Actual completion date/time. */
  completedAt: Date;
  /**
   * Odometer at completion. Optional for a direct log: when absent the record
   * carries no reading and no ledger entry is written.
   */
  odometerKm?: number;
  workPerformed: string;
  providerName?: string;
  technicianName?: string;
  /** Person who received the payment, when the cost was paid to an individual. */
  paidTo?: string;
  notes?: string;
  /** PM schedules this work actually serviced — their baselines are reset. */
  scheduleIds: string[];
  recordedByUserId: string;
  /** Makes retried submissions idempotent. */
  clientToken?: string;
  /** Cost to record as the linked MAINTENANCE expense, persisted as intent. */
  repairCost?: {
    amountMinor: number;
    currency: string;
    /** Workmanship portion when the cost was itemised. */
    labourMinor?: number;
    /** Parts/consumables when the cost was itemised. */
    items?: ServiceCostItem[];
  };
}

export interface LogServiceResult {
  serviceRecord: ServiceRecord;
  duplicate: boolean;
  resetScheduleIds: string[];
}

/**
 * Odometer supplied by a direct service log. Absent or blank is allowed — the
 * record then carries no reading (never a fabricated 0). Anything else must be
 * a non-negative whole kilometre, rejected loudly rather than silently dropped.
 */
export function resolveServiceOdometer(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  if (typeof value !== "number" && typeof value !== "string") {
    throw new ServiceLogError(
      "INVALID_ODOMETER",
      "odometerKm must be a non-negative integer when provided",
    );
  }
  const km = Number(value);
  if (!Number.isSafeInteger(km) || km < 0) {
    throw new ServiceLogError(
      "INVALID_ODOMETER",
      "odometerKm must be a non-negative integer when provided",
    );
  }
  return km;
}

/**
 * Pure pre-checks, extracted so they can be unit-tested without Firestore.
 * Schedules must exist and belong to the vehicle being serviced — a schedule
 * is never reset because the request merely named it.
 */
export function planServiceLogging(input: {
  vehicleId: string;
  workPerformed: string;
  completedAt: Date;
  /** Short label the caller supplied, e.g. "Oil & filter change". */
  explicitTaskName?: string;
  fetchedSchedules: { id: string; vehicleId?: string; exists: boolean; taskName?: string }[];
  requestedScheduleIds: string[];
}): { taskName: string | null } {
  if (new Set(input.requestedScheduleIds).size !== input.requestedScheduleIds.length) {
    throw new ServiceLogError("DUPLICATE_SCHEDULE", "Duplicate ids in scheduleIds");
  }
  const taskNames: string[] = [];
  for (const scheduleId of input.requestedScheduleIds) {
    const schedule = input.fetchedSchedules.find((s) => s.id === scheduleId);
    if (!schedule || !schedule.exists) {
      throw new ServiceLogError("SCHEDULE_NOT_FOUND", `Schedule ${scheduleId} not found`);
    }
    if (String(schedule.vehicleId ?? "") !== input.vehicleId) {
      throw new ServiceLogError(
        "SCHEDULE_VEHICLE_MISMATCH",
        `Schedule ${scheduleId} does not belong to vehicle ${input.vehicleId}`,
      );
    }
    if (schedule.taskName) taskNames.push(schedule.taskName);
  }
  // History views label a record by its task: a serviced PM task wins, then an
  // explicit label, then the work itself — never an empty heading.
  const explicit = (input.explicitTaskName ?? "").trim();
  const fallback = explicit || input.workPerformed.slice(0, 100);
  return { taskName: taskNames[0] ?? (fallback || null) };
}

export async function logService(input: LogServiceInput): Promise<LogServiceResult> {
  const { COLLECTIONS } = await import("@/lib/db/collections");
  const { getAdminDb } = await import("@/lib/firebase/admin");
  const { validateReading } = await import("@/lib/domain/odometer");
  const { findServiceRecordByKey } = await import("@/lib/repos/maintenance");

  const db = getAdminDb();
  const vehicleId = input.vehicleId;
  const workPerformed = input.workPerformed.trim();
  if (!workPerformed || workPerformed.length > 5000) {
    throw new ServiceLogError("INVALID_WORK", "workPerformed is required (max 5000 chars)");
  }

  // Idempotency: a retried submission finds the record it already created.
  const idempotencyKey = input.clientToken
    ? `direct:${vehicleId}:${input.clientToken.slice(0, 100)}`
    : undefined;
  if (idempotencyKey) {
    const existing = await findServiceRecordByKey(idempotencyKey);
    if (existing) return { serviceRecord: existing, duplicate: true, resetScheduleIds: [] };
  }

  const vehicleSnap = await db.collection(COLLECTIONS.vehicles).doc(vehicleId).get();
  if (!vehicleSnap.exists) throw new ServiceLogError("VEHICLE_NOT_FOUND", "Vehicle not found");
  const projection = Number(vehicleSnap.data()?.odometerKm ?? 0);
  if (input.odometerKm !== undefined) {
    const validation = validateReading(input.odometerKm, "SERVICE_COMPLETION", projection);
    if (!validation.ok) {
      throw new ServiceLogError(validation.code, validation.message);
    }
  }

  // Schedules must exist and belong to this vehicle — pure, unit-tested check.
  const schedulesRef = db.collection(COLLECTIONS.maintenanceSchedules);
  const fetchedSchedules = await Promise.all(
    input.scheduleIds.map(async (scheduleId) => {
      const snap = await schedulesRef.doc(scheduleId).get();
      return {
        id: scheduleId,
        exists: snap.exists,
        vehicleId: snap.exists ? String(snap.data()?.vehicleId ?? "") : undefined,
        taskName: snap.exists ? String(snap.data()?.taskName ?? "") : undefined,
      };
    }),
  );
  const plan = planServiceLogging({
    vehicleId,
    workPerformed,
    completedAt: input.completedAt,
    explicitTaskName: input.taskName,
    fetchedSchedules,
    requestedScheduleIds: input.scheduleIds,
  });

  const serviceRecordsRef = db.collection(COLLECTIONS.serviceRecords);
  const serviceRecordId = serviceRecordsRef.doc().id;
  const now = new Date();

  const serviceRecord: ServiceRecord = {
    id: serviceRecordId,
    vehicleId,
    scheduleId: input.scheduleIds[0],
    taskName: plan.taskName ?? "Service",
    completedAt: input.completedAt,
    odometerKm: input.odometerKm ?? null,
    workPerformed,
    providerName: input.providerName,
    technicianName: input.technicianName,
    paidTo: input.paidTo,
    notes: input.notes,
    expenseIds: [],
    repairCostMinor: input.repairCost?.amountMinor,
    repairCostCurrency: input.repairCost?.currency,
    labourCostMinor: input.repairCost?.labourMinor,
    costItems: input.repairCost?.items,
    resolvedIssueIds: [],
    recordedByUserId: input.recordedByUserId,
    createdAt: now,
    idempotencyKey,
  };

  const definedOnly = (data: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));

  await db.runTransaction(async (tx) => {
    tx.set(serviceRecordsRef.doc(serviceRecordId), definedOnly({ ...serviceRecord }));

    // A missing reading never invents one. The schedule baseline falls back to
    // the vehicle's last accepted reading, which can only make the next due
    // point earlier — never later — than the true service mileage.
    const baselineKm = input.odometerKm ?? projection;
    for (const scheduleId of input.scheduleIds) {
      tx.update(schedulesRef.doc(scheduleId), {
        lastServiceOdometerKm: baselineKm,
        lastServiceDate: input.completedAt,
        lastServiceRecordId: serviceRecordId,
        updatedAt: now,
      });
    }

    // Same ledger entry shape as work-order completion, so the odometer story
    // of the vehicle stays consistent whichever path recorded the service.
    if (input.odometerKm !== undefined) {
      const readingId = `${vehicleId}_svc-direct-${input.clientToken ?? serviceRecordId}`;
      tx.set(db.collection(COLLECTIONS.odometerReadings).doc(readingId), {
        vehicleId,
        km: input.odometerKm,
        effectiveAt: input.completedAt,
        createdAt: now,
        recordedByUserId: input.recordedByUserId,
        source: "SERVICE_COMPLETION",
        serviceRecordId,
        notes: `Service log — ${workPerformed.slice(0, 200)}`,
        status: "ACCEPTED",
        deltaKm: input.odometerKm - projection,
        clientToken: `svc-direct-${input.clientToken ?? serviceRecordId}`,
      });
      if (input.odometerKm > projection) {
        tx.update(db.collection(COLLECTIONS.vehicles).doc(vehicleId), {
          odometerKm: input.odometerKm,
          odometerAt: input.completedAt,
          odometerSource: "SERVICE_COMPLETION",
          updatedAt: now,
        });
      }
    }
  });

  return { serviceRecord, duplicate: false, resetScheduleIds: input.scheduleIds };
}
