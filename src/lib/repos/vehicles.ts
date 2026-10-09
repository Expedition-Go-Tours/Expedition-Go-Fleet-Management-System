import type { DocumentData } from "firebase-admin/firestore";

import type { Vehicle, VehicleStatus } from "@/lib/domain/vehicle";
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
    mileage: Number(data.mileage ?? 0),
    status: (data.status ?? "ACTIVE") as VehicleStatus,
    safetyHoldReason: data.safetyHoldReason ? String(data.safetyHoldReason) : undefined,
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
  mileage: number;
  createdBy: string;
}

export async function createVehicle(input: CreateVehicleInput): Promise<Vehicle> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const now = FieldValue.serverTimestamp();
  const doc = await vehiclesRef().add({
    ...input,
    vin: input.vin ?? null,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
  const created = await getVehicleById(doc.id);
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
  // Fetch + filter in memory: fleets are small, and this avoids a composite
  // index just to exclude ARCHIVED while keeping newest-first ordering.
  return vehicles.filter((vehicle) => vehicle.status !== "ARCHIVED");
}

export interface UpdateVehicleFields {
  make?: string;
  model?: string;
  year?: number;
  type?: Vehicle["type"];
  vin?: string;
  /** Odometer — must never decrease (enforced by the route). */
  mileage?: number;
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

/** Apply a lifecycle transition with optional per-action fields. */
export async function applyVehicleStatus(
  id: string,
  status: VehicleStatus,
  extra?: { safetyHoldReason?: string },
): Promise<Vehicle> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const update: Record<string, unknown> = {
    status,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (status === "SAFETY_HOLD") {
    update.safetyHoldReason = extra?.safetyHoldReason ?? null;
  }
  if (status === "ARCHIVED") {
    update.archivedAt = FieldValue.serverTimestamp();
  }
  if (status === "ACTIVE") {
    update.safetyHoldReason = null;
  }
  await vehiclesRef().doc(id).update(update);
  const updated = await getVehicleById(id);
  if (!updated) throw new Error("Vehicle not found after status change");
  return updated;
}
