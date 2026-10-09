import type { DocumentData } from "firebase-admin/firestore";

import type { Expense, ExpenseStatus } from "@/lib/domain/expense";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import { toDate } from "@/lib/repos/timestamps";

/** Firestore-backed expense repository. Amounts are integer minor units. */

function expensesRef() {
  return getAdminDb().collection(COLLECTIONS.expenses);
}

function toExpense(id: string, data: DocumentData): Expense {
  return {
    id,
    workOrderId: String(data.workOrderId ?? ""),
    vehicleId: String(data.vehicleId ?? ""),
    category: (data.category ?? "OTHER") as Expense["category"],
    amountMinor: Number(data.amountMinor ?? 0),
    currency: String(data.currency ?? "GHS"),
    description: String(data.description ?? ""),
    receiptKey: data.receiptKey ? String(data.receiptKey) : undefined,
    status: (data.status ?? "PENDING") as ExpenseStatus,
    createdBy: String(data.createdBy ?? ""),
    createdAt: toDate(data.createdAt) ?? new Date(0),
    updatedAt: toDate(data.updatedAt) ?? new Date(0),
    approvedBy: data.approvedBy ? String(data.approvedBy) : undefined,
    approvedAt: toDate(data.approvedAt),
    paidAt: toDate(data.paidAt),
    voidedBy: data.voidedBy ? String(data.voidedBy) : undefined,
    voidedAt: toDate(data.voidedAt),
  };
}

export interface CreateExpenseInput {
  workOrderId: string;
  vehicleId: string;
  category: Expense["category"];
  amountMinor: number;
  currency: string;
  description: string;
  receiptKey?: string;
  createdBy: string;
}

export async function createExpense(input: CreateExpenseInput): Promise<Expense> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const now = FieldValue.serverTimestamp();
  const doc = await expensesRef().add({
    ...input,
    receiptKey: input.receiptKey ?? null,
    status: "PENDING",
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

export async function listExpenses(options?: {
  workOrderId?: string;
  vehicleId?: string;
  status?: ExpenseStatus;
  limit?: number;
}): Promise<Expense[]> {
  let query: import("firebase-admin/firestore").Query = expensesRef();
  if (options?.workOrderId) {
    query = query.where("workOrderId", "==", options.workOrderId);
  }
  if (options?.vehicleId) {
    query = query.where("vehicleId", "==", options.vehicleId);
  }
  if (options?.status) {
    query = query.where("status", "==", options.status);
  }
  // Equality-only filters + in-memory ordering: avoids composite indexes.
  const snap = await query.limit(2000).get();
  return snap.docs
    .map((doc) => toExpense(doc.id, doc.data()))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, options?.limit ?? 1000);
}

export async function updateExpenseDescription(id: string, description: string): Promise<Expense> {
  const { FieldValue } = await import("firebase-admin/firestore");
  await expensesRef().doc(id).update({
    description,
    updatedAt: FieldValue.serverTimestamp(),
  });
  const updated = await getExpenseById(id);
  if (!updated) throw new Error("Expense not found after update");
  return updated;
}

/**
 * Apply a lifecycle transition.
 * approve/mark_paid record the acting user; void records who voided it.
 */
export async function applyExpenseStatus(
  id: string,
  status: ExpenseStatus,
  actorId: string,
): Promise<Expense> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const update: Record<string, unknown> = {
    status,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (status === "APPROVED") {
    update.approvedBy = actorId;
    update.approvedAt = FieldValue.serverTimestamp();
  }
  if (status === "PAID") {
    update.paidAt = FieldValue.serverTimestamp();
  }
  if (status === "VOID") {
    update.voidedBy = actorId;
    update.voidedAt = FieldValue.serverTimestamp();
  }
  await expensesRef().doc(id).update(update);
  const updated = await getExpenseById(id);
  if (!updated) throw new Error("Expense not found after status change");
  return updated;
}

/** Sum of PAID expenses (minor units) — used by finance exports. */
export async function totalPaidMinor(options?: {
  vehicleId?: string;
  workOrderId?: string;
}): Promise<number> {
  let query = expensesRef().where("status", "==", "PAID");
  if (options?.vehicleId) query = query.where("vehicleId", "==", options.vehicleId);
  if (options?.workOrderId) query = query.where("workOrderId", "==", options.workOrderId);
  const snap = await query.get();
  return snap.docs.reduce((sum, doc) => sum + Number(doc.data().amountMinor ?? 0), 0);
}
