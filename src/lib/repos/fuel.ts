import type { DocumentData } from "firebase-admin/firestore";

import type { FuelEntry } from "@/lib/domain/fuel";
import { auditSnapshot, DeletionError, type DeletionAudit } from "@/lib/domain/deletion";
import { writeAuditEventInTx } from "@/lib/repos/audit";
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
    odometerKm: typeof data.odometerKm === "number" ? data.odometerKm : undefined,
    odometerReadingId: data.odometerReadingId ? String(data.odometerReadingId) : undefined,
    fuelType: String(data.fuelType ?? "PETROL"),
    litres: typeof data.litres === "number" ? data.litres : undefined,
    unitPriceMinor: typeof data.unitPriceMinor === "number" ? data.unitPriceMinor : undefined,
    totalMinor: Number(data.totalMinor ?? 0),
    currency: String(data.currency ?? "GHS"),
    station: data.station ? String(data.station) : undefined,
    paidTo: data.paidTo ? String(data.paidTo) : undefined,
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
  odometerKm?: number;
  odometerReadingId?: string;
  fuelType: string;
  litres?: number;
  unitPriceMinor?: number;
  totalMinor: number;
  currency: string;
  station?: string;
  paidTo?: string;
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
      odometerKm: input.odometerKm ?? null,
      odometerReadingId: input.odometerReadingId ?? null,
      fuelType: input.fuelType,
      litres: input.litres ?? null,
      unitPriceMinor: input.unitPriceMinor ?? null,
      totalMinor: input.totalMinor,
      currency: input.currency,
      station: input.station ?? null,
      paidTo: input.paidTo ?? null,
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

export class FuelEntryError extends Error {
  constructor(
    public readonly code: "FUEL_ENTRY_NOT_FOUND" | "LINKED_EXPENSE_MISSING",
    message: string,
  ) {
    super(message);
    this.name = "FuelEntryError";
  }
}

export interface CorrectFuelEntryInput {
  id: string;
  transactedOn: string;
  totalMinor: number;
  fuelType: string;
  /** Blank clears the station (and the expense supplier). */
  station?: string;
  /** Blank clears the payee. */
  paidTo?: string;
  fullTank: boolean;
}

export interface DeleteFuelEntryResult {
  before: FuelEntry;
  /** Canonical expense removed with the purchase, when one was linked. */
  deletedExpenseId?: string;
  /** Odometer observation kept as mileage history, with its fuel link cleared. */
  unlinkedOdometerReadingId?: string;
}

/**
 * Permanently delete one fuel purchase (ADMIN only, with a written reason).
 *
 * The canonical expense is removed in the same transaction — it exists only
 * because of this purchase. The odometer reading is deliberately kept: it is a
 * mileage observation, not money, and deleting it could rewrite the vehicle's
 * odometer history. Only its link to the purchase is cleared.
 */
export async function deleteFuelEntryRecord(
  id: string,
  audit?: DeletionAudit,
): Promise<DeleteFuelEntryResult> {
  const db = getAdminDb();
  const entryRef = fuelRef().doc(id);

  return db.runTransaction(async (tx) => {
    const entrySnap = await tx.get(entryRef);
    if (!entrySnap.exists) {
      throw new DeletionError("FUEL_ENTRY_NOT_FOUND", "Fuel entry not found");
    }
    const before = toFuelEntry(entrySnap.id, entrySnap.data() ?? {});

    const expenseRef = before.expenseId
      ? db.collection(COLLECTIONS.expenses).doc(before.expenseId)
      : null;
    const readingRef = before.odometerReadingId
      ? db.collection(COLLECTIONS.odometerReadings).doc(before.odometerReadingId)
      : null;

    const expenseSnap = expenseRef ? await tx.get(expenseRef) : null;
    const readingSnap = readingRef ? await tx.get(readingRef) : null;

    let deletedExpenseId: string | undefined;
    let deletedExpense: unknown;
    let unlinkedOdometerReadingId: string | undefined;

    if (expenseRef && expenseSnap?.exists) {
      tx.delete(expenseRef);
      deletedExpenseId = expenseRef.id;
      deletedExpense = auditSnapshot({ id: expenseSnap.id, ...expenseSnap.data() });
    }

    if (
      readingRef &&
      readingSnap?.exists &&
      String(readingSnap.data()?.fuelEntryId ?? "") === before.id
    ) {
      tx.update(readingRef, { fuelEntryId: null });
      unlinkedOdometerReadingId = readingRef.id;
    }

    if (audit) {
      writeAuditEventInTx(tx, {
        ...audit,
        before: auditSnapshot(before),
        after: {
          deletedExpenseId: deletedExpenseId ?? null,
          deletedExpense: deletedExpense ?? null,
          unlinkedOdometerReadingId: unlinkedOdometerReadingId ?? null,
        },
      });
    }

    tx.delete(entryRef);
    return { before, deletedExpenseId, unlinkedOdometerReadingId };
  });
}

/**
 * Correct the editable fields of a recorded purchase. The linked canonical
 * expense is updated in the SAME transaction — amount, description, supplier,
 * payee and incurred date — so the fuel ledger and the money ledger can never
 * disagree. The vehicle, odometer link and recorded-by stamp are immutable.
 */
export async function correctFuelEntry(
  input: CorrectFuelEntryInput,
): Promise<{ before: FuelEntry; after: FuelEntry }> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const db = getAdminDb();
  const entryRef = fuelRef().doc(input.id);

  return db.runTransaction(async (tx) => {
    const entrySnap = await tx.get(entryRef);
    if (!entrySnap.exists) {
      throw new FuelEntryError("FUEL_ENTRY_NOT_FOUND", "Fuel entry not found");
    }
    const before = toFuelEntry(entrySnap.id, entrySnap.data() ?? {});

    // Firestore transactions require every read before the first write.
    const expenseRef = before.expenseId
      ? db.collection(COLLECTIONS.expenses).doc(before.expenseId)
      : null;
    if (expenseRef) {
      const expenseSnap = await tx.get(expenseRef);
      if (!expenseSnap.exists) {
        // Editing only the fuel row would silently desync the money ledger.
        throw new FuelEntryError(
          "LINKED_EXPENSE_MISSING",
          "The linked expense is missing — correction not applied",
        );
      }
    }

    const now = FieldValue.serverTimestamp();
    tx.update(entryRef, {
      transactedOn: input.transactedOn,
      totalMinor: input.totalMinor,
      fuelType: input.fuelType,
      station: input.station ?? null,
      paidTo: input.paidTo ?? null,
      fullTank: input.fullTank,
      updatedAt: now,
    });

    if (expenseRef) {
      tx.update(expenseRef, {
        amountMinor: input.totalMinor,
        description: `${before.litres !== undefined ? `${before.litres}L ` : ""}${input.fuelType}${
          input.station ? ` @ ${input.station}` : ""
        }`,
        supplierName: input.station ?? null,
        paidTo: input.paidTo ?? null,
        incurredOn: new Date(`${input.transactedOn}T12:00:00Z`),
        updatedAt: now,
      });
    }

    return {
      before,
      after: {
        ...before,
        transactedOn: input.transactedOn,
        totalMinor: input.totalMinor,
        fuelType: input.fuelType,
        station: input.station,
        paidTo: input.paidTo,
        fullTank: input.fullTank,
      },
    };
  });
}
