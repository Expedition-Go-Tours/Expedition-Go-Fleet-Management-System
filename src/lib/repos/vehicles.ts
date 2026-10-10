import type { DocumentData } from "firebase-admin/firestore";

import type { FuelType, OwnershipClass, Vehicle, VehicleStatus } from "@/lib/domain/vehicle";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import { toDate } from "@/lib/repos/timestamps";

/** Firestore-backed vehicle repository. Server-only (Admin SDK). */

function vehiclesRef() {
  return getAdminDb().collection(COLLECTIONS.vehicles);
}

function toVehicle(id: string, data: DocumentData): Vehicle {
  return {
    id,
    regNumber: String(data.regNumber ?? ""),
    make: String(data.make ?? ""),
    model: String(data.model ?? ""),
    year: Number(data.year ?? 0),
    type: (data.type ?? "OTHER") as Vehicle["type"],
    vin: data.vin ? String(data.vin) : undefined,
    seatingCapacity: typeof data.seatingCapacity === "number" ? data.seatingCapacity : undefined,
    fuelType: data.fuelType ? (String(data.fuelType) as FuelType) : undefined,
    ownership: (data.ownership ?? "COMPANY_OWNED") as OwnershipClass,
    acquiredOn: data.acquiredOn ? String(data.acquiredOn) : undefined,
    inServiceOn: data.inServiceOn ? String(data.inServiceOn) : undefined,
    // `mileage` is the legacy field name; `odometerKm` is the projection.
    odometerKm: Number(data.odometerKm ?? data.mileage ?? 0),
    odometerAt: toDate(data.odometerAt),
    odometerSource: data.odometerSource ? String(data.odometerSource) : undefined,
    status: (data.status ?? "ACTIVE") as VehicleStatus,
    safetyHoldReason: data.safetyHoldReason ? String(data.safetyHoldReason) : undefined,
    safetyHoldIssueId: data.safetyHoldIssueId ? String(data.safetyHoldIssueId) : undefined,
    safetyHoldAppliedBy: data.safetyHoldAppliedBy ? String(data.safetyHoldAppliedBy) : undefined,
    safetyHoldAppliedAt: toDate(data.safetyHoldAppliedAt),
    archivedAt: toDate(data.archivedAt),
    createdAt: toDate(data.createdAt) ?? new Date(0),
    updatedAt: toDate(data.updatedAt) ?? new Date(0),
    createdBy: String(data.createdBy ?? ""),
  };
}

export interface CreateVehicleInput {
  regNumber: string;
  make: string;
  model: string;
  year: number;
  type: Vehicle["type"];
  vin?: string;
  seatingCapacity?: number;
  fuelType?: FuelType;
  ownership?: OwnershipClass;
  acquiredOn?: string;
  inServiceOn?: string;
  /** Initial baseline odometer — explicit, audited setup path. */
  odometerKm?: number;
  createdBy: string;
}

/** Raised when atomic vehicle creation cannot proceed (duplicate plate). */
export class VehicleCreationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "VehicleCreationError";
    this.code = code;
  }
}

export interface CreateVehicleAtomicInput extends CreateVehicleInput {
  requestId?: string;
}

/**
 * Register a vehicle, its initial odometer ledger entry, its current-odometer
 * projection and the `vehicle.created` audit event in ONE Firestore
 * transaction.
 *
 * Duplicate registration numbers are prevented atomically by a deterministic
 * lock document keyed by the normalized plate (`registrationLocks/<PLATE>`):
 * two concurrent registrations of the same plate contend on the same document,
 * so exactly one wins. A partially created vehicle is impossible — either the
 * whole record (vehicle + ledger + audit) commits or none of it does.
 */
export async function createVehicleAtomic(input: CreateVehicleAtomicInput): Promise<Vehicle> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const db = getAdminDb();
  const now = FieldValue.serverTimestamp();
  const initialKm = input.odometerKm ?? 0;

  const vehicleRef = vehiclesRef().doc();
  const regNumber = input.regNumber.trim().toUpperCase();
  const lockRef = db.collection(COLLECTIONS.registrationLocks).doc(regNumber);
  const readingRef = db
    .collection(COLLECTIONS.odometerReadings)
    .doc(`${vehicleRef.id}_setup-${vehicleRef.id}`);
  const auditRef = db.collection(COLLECTIONS.auditLogs).doc();

  await db.runTransaction(async (tx) => {
    // Reads before writes.
    const lockSnap = await tx.get(lockRef);
    if (lockSnap.exists) {
      throw new VehicleCreationError(
        "DUPLICATE_REGISTRATION",
        `A vehicle with registration "${regNumber}" already exists`,
      );
    }

    tx.set(vehicleRef, {
      regNumber,
      make: input.make,
      model: input.model,
      year: input.year,
      type: input.type,
      vin: input.vin ?? null,
      seatingCapacity: input.seatingCapacity ?? null,
      fuelType: input.fuelType ?? null,
      ownership: input.ownership ?? "COMPANY_OWNED",
      acquiredOn: input.acquiredOn ?? null,
      inServiceOn: input.inServiceOn ?? null,
      odometerKm: initialKm,
      odometerAt: initialKm > 0 ? now : null,
      odometerSource: initialKm > 0 ? "MANUAL_ENTRY" : null,
      status: "ACTIVE",
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    });

    if (initialKm > 0) {
      tx.set(readingRef, {
        vehicleId: vehicleRef.id,
        km: initialKm,
        effectiveAt: now,
        createdAt: now,
        recordedByUserId: input.createdBy,
        source: "MANUAL_ENTRY",
        notes: "Initial odometer baseline at vehicle registration",
        status: "ACCEPTED",
        deltaKm: initialKm,
        clientToken: `setup-${vehicleRef.id}`,
      });
    }

    tx.set(lockRef, {
      vehicleId: vehicleRef.id,
      regNumber,
      createdAt: now,
    });

    // Audit event inside the same transaction: the registration and its audit
    // trail commit together.
    tx.set(auditRef, {
      eventType: "vehicle.created",
      actorId: input.createdBy,
      entityType: "vehicle",
      entityId: vehicleRef.id,
      before: null,
      after: {
        regNumber,
        make: input.make,
        model: input.model,
        odometerKm: initialKm,
      },
      reason: null,
      requestId: input.requestId ?? null,
      outcome: "SUCCESS",
      createdAt: now,
    });
  });

  const created = await getVehicleById(vehicleRef.id);
  if (!created) throw new Error("Vehicle not found after creation");
  return created;
}

export async function getVehicleById(id: string): Promise<Vehicle | null> {
  const snap = await vehiclesRef().doc(id).get();
  if (!snap.exists) return null;
  return toVehicle(snap.id, snap.data() ?? {});
}

/** Case-insensitive uniqueness check on the registration number. */
export async function getVehicleByRegNumber(regNumber: string): Promise<Vehicle | null> {
  const normalized = regNumber.trim().toUpperCase();
  const snap = await vehiclesRef().where("regNumber", "==", normalized).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0]!;
  return toVehicle(doc.id, doc.data());
}

/** Newest-first list. Optionally exclude archived vehicles. */
export async function listVehicles(options?: {
  includeArchived?: boolean;
  limit?: number;
}): Promise<Vehicle[]> {
  const query = vehiclesRef()
    .orderBy("createdAt", "desc")
    .limit(options?.limit ?? 500);
  const snap = await query.get();
  const vehicles = snap.docs.map((doc) => toVehicle(doc.id, doc.data()));
  if (options?.includeArchived) return vehicles;
  return vehicles.filter((v) => v.status !== "ARCHIVED");
}

export interface UpdateVehicleFields {
  make?: string;
  model?: string;
  year?: number;
  type?: Vehicle["type"];
  vin?: string;
  seatingCapacity?: number;
  fuelType?: FuelType;
  acquiredOn?: string;
  inServiceOn?: string;
}

export async function updateVehicle(id: string, fields: UpdateVehicleFields): Promise<Vehicle> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const cleaned = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
  await vehiclesRef()
    .doc(id)
    .update({
      ...cleaned,
      updatedAt: FieldValue.serverTimestamp(),
    });
  const updated = await getVehicleById(id);
  if (!updated) throw new Error("Vehicle not found after update");
  return updated;
}

/**
 * Apply a lifecycle transition with optional per-action fields.
 * `safety_hold` records who applied it and which issue caused it.
 */
export async function applyVehicleStatus(
  id: string,
  status: VehicleStatus,
  extra?: { safetyHoldReason?: string; actorId?: string; issueId?: string },
): Promise<Vehicle> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const update: Record<string, unknown> = {
    status,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (status === "SAFETY_HOLD") {
    update.safetyHoldReason = extra?.safetyHoldReason ?? null;
    update.safetyHoldIssueId = extra?.issueId ?? null;
    update.safetyHoldAppliedBy = extra?.actorId ?? null;
    update.safetyHoldAppliedAt = FieldValue.serverTimestamp();
  }
  if (status === "ARCHIVED") {
    update.archivedAt = FieldValue.serverTimestamp();
  }
  if (status === "ACTIVE") {
    update.safetyHoldReason = null;
    update.safetyHoldIssueId = null;
    update.safetyHoldAppliedBy = null;
    update.safetyHoldAppliedAt = null;
  }
  await vehiclesRef().doc(id).update(update);
  const updated = await getVehicleById(id);
  if (!updated) throw new Error("Vehicle not found after status change");
  return updated;
}

/**
 * Effective availability for assignment: a vehicle is assignable when it is
 * ACTIVE and has no open critical issue.
 */
export async function countOpenCriticalIssues(vehicleId: string): Promise<number> {
  const snap = await getAdminDb()
    .collection(COLLECTIONS.maintenanceReports)
    .where("vehicleId", "==", vehicleId)
    .get();
  return snap.docs.filter((d) => {
    const data = d.data();
    return data.severity === "CRITICAL" && data.safetyCritical === true && data.status !== "CLOSED";
  }).length;
}
