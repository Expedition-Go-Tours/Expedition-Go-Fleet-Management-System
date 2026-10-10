import type { DocumentData } from "firebase-admin/firestore";

import type { Expense, ExpenseStatus } from "@/lib/domain/expense";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import { toDate } from "@/lib/repos/timestamps";

/*
 * Firestore-backed expense repository. Amounts are integer pesewas.
 * Approval happens outside this system — the only state change is void.
 */

function expensesRef() {
  return getAdminDb().collection(COLLECTIONS.expenses);
}

function toExpense(id: string, data: DocumentData): Expense {
  return {
    id,
    vehicleId: String(data.vehicleId ?? ""),
    workOrderId: data.workOrderId ? String(data.workOrderId) : undefined,
    serviceRecordId: data.serviceRecordId ? String(data.serviceRecordId) : undefined,
    fuelEntryId: data.fuelEntryId ? String(data.fuelEntryId) : undefined,
    category: (data.category ?? "OTHER") as Expense["category"],
    amountMinor: Number(data.amountMinor ?? 0),
    currency: String(data.currency ?? "GHS"),
    description: String(data.description ?? ""),
    supplierName: data.supplierName ? String(data.supplierName) : undefined,
    providerId: data.providerId ? String(data.providerId) : undefined,
    receiptKey: data.receiptKey ? String(data.receiptKey) : undefined,
    externalReference: data.externalReference ? String(data.externalReference) : undefined,
    incurredOn: toDate(data.incurredOn) ?? toDate(data.createdAt) ?? new Date(0),
    status: (data.status ?? "RECORDED") as ExpenseStatus,
    createdBy: String(data.createdBy ?? ""),
    createdAt: toDate(data.createdAt) ?? new Date(0),
    updatedAt: toDate(data.updatedAt) ?? new Date(0),
    voidedBy: data.voidedBy ? String(data.voidedBy) : undefined,
    voidedAt: data.voidedAt ? String(data.voidedAt) : undefined,
    voidReason: data.voidReason ? String(data.voidReason) : undefined,
  };
}

export interface CreateExpenseInput {
  vehicleId: string;
  workOrderId?: string;
  serviceRecordId?: string;
  fuelEntryId?: string;
  category: Expense["category"];
  amountMinor: number;
  currency: string;
  description: string;
  supplierName?: string;
  providerId?: string;
  receiptKey?: string;
  externalReference?: string;
  incurredOn?: Date;
  createdBy: string;
}

export async function createExpense(input: CreateExpenseInput): Promise<Expense> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const now = FieldValue.serverTimestamp();
  const doc = await expensesRef().add({
    ...input,
    workOrderId: input.workOrderId ?? null,
    serviceRecordId: input.serviceRecordId ?? null,
    fuelEntryId: input.fuelEntryId ?? null,
    supplierName: input.supplierName ?? null,
    providerId: input.providerId ?? null,
    receiptKey: input.receiptKey ?? null,
    externalReference: input.externalReference ?? null,
    incurredOn: input.incurredOn ?? new Date(),
    status: "RECORDED",
    createdAt: now,
    updatedAt: now,
  });
  const created = await getExpenseById(doc.id);
  if (!created) throw new Error("Expense not found after creation");
  return created;
}

export async function getExpenseById(id: string): Promise<Expense | null> {
  const snap = await expensesRef().doc(id).get();
  if (!snap.exists) return null;
  return toExpense(snap.id, snap.data() ?? {});
}

/**
 * Count expenses matching the same equality filters as `listExpenses`, via a
 * Firestore aggregation — nothing is truncated by a `limit`, so a displayed
 * count stays correct regardless of collection size.
 */
export async function countExpenses(options?: {
  vehicleId?: string;
  workOrderId?: string;
  status?: ExpenseStatus;
}): Promise<number> {
  let query: import("firebase-admin/firestore").Query = expensesRef();
  if (options?.vehicleId) query = query.where("vehicleId", "==", options.vehicleId);
  if (options?.workOrderId) query = query.where("workOrderId", "==", options.workOrderId);
  if (options?.status) query = query.where("status", "==", options.status);
  const snap = await query.count().get();
  return snap.data().count;
}

export async function listExpenses(options?: {
  vehicleId?: string;
  workOrderId?: string;
  status?: ExpenseStatus;
  category?: string;
  limit?: number;
}): Promise<Expense[]> {
  // Equality-only filters + in-memory ordering: avoids composite indexes.
  let query: import("firebase-admin/firestore").Query = expensesRef();
  if (options?.vehicleId) {
    query = query.where("vehicleId", "==", options.vehicleId);
  }
  if (options?.workOrderId) {
    query = query.where("workOrderId", "==", options.workOrderId);
  }
  if (options?.status) {
    query = query.where("status", "==", options.status);
  }
  const snap = await query.limit(2000).get();
  return snap.docs
    .map((doc) => toExpense(doc.id, doc.data()))
    .sort((a, b) => b.incurredOn.getTime() - a.incurredOn.getTime())
    .slice(0, options?.limit ?? 1000);
}

/**
 * Void an expense: keep the record, mark it VOID with actor + reason.
 * Never a hard delete — financial history is accountability.
 */
export async function voidExpense(id: string, actorId: string, reason: string): Promise<Expense> {
  const { FieldValue } = await import("firebase-admin/firestore");
  await expensesRef()
    .doc(id)
    .update({
      status: "VOID",
      voidedBy: actorId,
      voidedAt: new Date().toISOString(),
      voidReason: reason.slice(0, 1000),
      updatedAt: FieldValue.serverTimestamp(),
    });
  const updated = await getExpenseById(id);
  if (!updated) throw new Error("Expense not found after void");
  return updated;
}

/** Update descriptive (non-amount) fields on a still-RECORDED expense. */
export async function updateExpenseDetails(
  id: string,
  fields: {
    description?: string;
    supplierName?: string;
    externalReference?: string;
    receiptKey?: string;
  },
): Promise<Expense> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const cleaned = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  await expensesRef()
    .doc(id)
    .update({
      ...cleaned,
      updatedAt: FieldValue.serverTimestamp(),
    });
  const updated = await getExpenseById(id);
  if (!updated) throw new Error("Expense not found after update");
  return updated;
}

/** Link a service record to the expense(s) it incurred. */
export async function linkExpenseToServiceRecord(
  expenseId: string,
  serviceRecordId: string,
): Promise<void> {
  const { FieldValue } = await import("firebase-admin/firestore");
  await expensesRef().doc(expenseId).update({
    serviceRecordId,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Sum of non-VOID expenses in pesewas. Fuel entries count once: entries whose
 * `fuelEntryId` is set are counted only if they are the canonical expense for
 * that fuel purchase (the fuel repo links exactly one).
 */
export async function totalExpensesMinor(options?: {
  vehicleId?: string;
  workOrderId?: string;
}): Promise<number> {
  let query: import("firebase-admin/firestore").Query = expensesRef();
  if (options?.vehicleId) query = query.where("vehicleId", "==", options.vehicleId);
  if (options?.workOrderId) query = query.where("workOrderId", "==", options.workOrderId);
  const snap = await query.limit(5000).get();
  return snap.docs
    .filter((doc) => doc.data().status !== "VOID")
    .reduce((sum, doc) => sum + Number(doc.data().amountMinor ?? 0), 0);
}
