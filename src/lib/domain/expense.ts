import { PERMISSIONS } from "@/lib/auth/permissions";
import type { ActionMap } from "@/lib/domain/lifecycle";

/* Expense domain model + lifecycle. Money is stored in integer minor units. */

export const EXPENSE_STATUSES = ["PENDING", "APPROVED", "PAID", "VOID"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_CATEGORIES = [
  "PARTS",
  "LABOUR",
  "FUEL",
  "INSPECTION",
  "TYRES",
  "TOWING",
  "PENALTY",
  "OTHER",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface Expense {
  id: string;
  workOrderId: string;
  vehicleId: string;
  category: ExpenseCategory;
  /** Amount in minor units (e.g. pesewas) — always an integer. */
  amountMinor: number;
  currency: string;
  description: string;
  /** URL/key of the receipt object in R2 (Phase 3 storage, deferred). */
  receiptKey?: string;
  status: ExpenseStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  approvedBy?: string;
  approvedAt?: Date;
  paidAt?: Date;
  voidedBy?: string;
  voidedAt?: Date;
}

/**
 * Expense transitions.
 *  - approve: finance reviews a pending expense (expense:update permission).
 *  - mark_paid: an approved expense is settled (expense:payment:update).
 *  - void: reverses a PENDING or APPROVED expense (expense:void).
 *  Paid expenses are never voided in place — voiding after settlement would
 *  corrupt the financial record; accounting handles reversals externally.
 */
export const EXPENSE_ACTIONS = {
  approve: {
    permission: PERMISSIONS.EXPENSE_UPDATE,
    from: ["PENDING"],
    to: "APPROVED",
  },
  mark_paid: {
    permission: PERMISSIONS.EXPENSE_PAYMENT_UPDATE,
    from: ["APPROVED"],
    to: "PAID",
  },
  void: {
    permission: PERMISSIONS.EXPENSE_VOID,
    from: ["PENDING", "APPROVED"],
    to: "VOID",
  },
} as const satisfies ActionMap<ExpenseStatus>;

/** Guards for expense creation: positive, bounded, integer amounts. */
export function isValidAmountMinor(amountMinor: unknown): amountMinor is number {
  return (
    typeof amountMinor === "number" &&
    Number.isSafeInteger(amountMinor) &&
    amountMinor > 0 &&
    amountMinor <= 100_000_000_00 // cap at 100M currency units in minor terms
  );
}
