import type { DocumentData } from "firebase-admin/firestore";

import type { FuelEntry } from "@/lib/domain/fuel";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import { toDate } from "@/lib/repos/timestamps";

/** Firestore-backed fuel entry repository. */

function fuelRef() {
  return getAdminDb().collection(COLLECTIONS.fuelEntries);
}

function toFuelEntry(id: string, data: DocumentData): FuelEntry {
  return {
    id,
    vehicleId: String(data.vehicleId ?? ""),
    transactedOn: String(data.transactedOn ?? ""),
    odometerKm: Number(data.odometerKm ?? 0),
    odometerReadingId: data.odometerReadingId ? String(data.odometerReadingId) : undefined,
    fuelType: String(data.fuelType ?? "PETROL"),
    litres: Number(data.litres ?? 0),
    unitPriceMinor: typeof data.unitPriceMinor === "number" ? data.unitPriceMinor : undefined,
    totalMinor: Number(data.totalMinor ?? 0),
    currency: String(data.currency ?? "GHS"),
    station: data.station ? String(data.station) : undefined,
    receiptKey: data.receiptKey ? String(data.receiptKey) : undefined,
    fullTank: data.fullTank === true,
    expenseId: data.expenseId ? String(data.expenseId) : undefined,
    recordedBy: String(data.recordedBy ?? ""),
    createdAt: toDate(data.createdAt) ?? new Date(0),
  };
}

export interface CreateFuelEntryInput {
  vehicleId: string;
  transactedOn: string;
  odometerKm: number;
  odometerReadingId?: string;
  fuelType: string;
  litres: number;
  unitPriceMinor?: number;
  totalMinor: number;
  currency: string;
  station?: string;
  receiptKey?: string;
  fullTank: boolean;
  expenseId?: string;
  recordedBy: string;
  clientToken?: string;
}

export async function createFuelEntry(input: CreateFuelEntryInput): Promise<FuelEntry> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const docId = input.clientToken
    ? fuelRef().doc(`${input.vehicleId}_${input.clientToken}`).id
    : fuelRef().doc().id;
  const existing = await fuelRef().doc(docId).get();
  if (existing.exists) return toFuelEntry(existing.id, existing.data() ?? {});

  await fuelRef()
    .doc(docId)
    .set({
      vehicleId: input.vehicleId,
      transactedOn: input.transactedOn,
      odometerKm: input.odometerKm,
      odometerReadingId: input.odometerReadingId ?? null,
      fuelType: input.fuelType,
      litres: input.litres,
      unitPriceMinor: input.unitPriceMinor ?? null,
      totalMinor: input.totalMinor,
      currency: input.currency,
      station: input.station ?? null,
      receiptKey: input.receiptKey ?? null,
      fullTank: input.fullTank,
      expenseId: input.expenseId ?? null,
      recordedBy: input.recordedBy,
      createdAt: FieldValue.serverTimestamp(),
    });
  const created = await getFuelEntryById(docId);
  if (!created) throw new Error("Fuel entry not found after creation");
  return created;
}

export async function getFuelEntryById(id: string): Promise<FuelEntry | null> {
  const snap = await fuelRef().doc(id).get();
  if (!snap.exists) return null;
  return toFuelEntry(snap.id, snap.data() ?? {});
}

/** Count fuel entries for a vehicle via aggregation. */
export async function countFuelEntries(vehicleId: string): Promise<number> {
  const snap = await fuelRef().where("vehicleId", "==", vehicleId).count().get();
  return snap.data().count;
}

export async function listFuelEntries(options?: {
  vehicleId?: string;
  limit?: number;
}): Promise<FuelEntry[]> {
  let query: import("firebase-admin/firestore").Query = fuelRef();
  if (options?.vehicleId) query = query.where("vehicleId", "==", options.vehicleId);
  const snap = await query.limit(2000).get();
  return snap.docs
    .map((d) => toFuelEntry(d.id, d.data()))
    .sort((a, b) => b.transactedOn.localeCompare(a.transactedOn))
    .slice(0, options?.limit ?? 200);
}
