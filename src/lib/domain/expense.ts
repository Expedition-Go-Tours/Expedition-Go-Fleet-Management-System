import { PERMISSIONS } from "@/lib/auth/permissions";
import type { ActionMap } from "@/lib/domain/lifecycle";

/*
 * Expense domain model.
 *
 * Approval happens OUTSIDE this system (business requirement). A recorded
 * expense is a fact; the only in-app state change is a void with a reason.
 * Money is stored as integer pesewas — never floats.
 */

export const EXPENSE_STATUSES = ["RECORDED", "VOID"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_CATEGORIES = [
  "MAINTENANCE",
  "PARTS",
  "LABOUR",
  "FUEL",
  "TYRES",
  "TOWING",
  "INSURANCE",
  "LICENSING",
  "INSPECTION",
  "PENALTY",
  "OTHER",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface Expense {
  id: string;
  vehicleId: string;
  /** Where the cost belongs; at most one of these is set. */
  workOrderId?: string;
  serviceRecordId?: string;
  fuelEntryId?: string;
  /** Canonical expense for a fuel entry — reports count each pesewa once. */
  category: ExpenseCategory;
  /** Amount in pesewas (GHS minor units) — always an integer. */
  amountMinor: number;
  currency: string;
  description: string;
  supplierName?: string;
  providerId?: string;
  /** Receipt/invoice evidence key in private storage. */
  receiptKey?: string;
  /** External reference (invoice number, Momo transaction, …). */
  externalReference?: string;
  /** Date the cost was incurred. */
  incurredOn: Date;
  status: ExpenseStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  voidedBy?: string;
  voidedAt?: string;
  voidReason?: string;
}

/**
 * The only lifecycle action: void (RECORDED → VOID), permission-controlled,
 * reason required by the route, audited. Paid/void states are terminal.
 */
export const EXPENSE_ACTIONS = {
  void: {
    permission: PERMISSIONS.EXPENSE_VOID,
    from: ["RECORDED"],
    to: "VOID",
  },
} as const satisfies ActionMap<ExpenseStatus>;

/** Guards for expense amounts: positive, bounded, integer pesewas. */
export function isValidAmountMinor(amountMinor: unknown): amountMinor is number {
  return (
    typeof amountMinor === "number" &&
    Number.isSafeInteger(amountMinor) &&
    amountMinor > 0 &&
    amountMinor <= 100_000_000_00 // cap at 100M cedis in pesewas
  );
}

/** Major-unit string/number → integer pesewas, without float drift. */
export function toPesewas(amount: unknown, exponent = 2): number | null {
  if (typeof amount === "number" && Number.isFinite(amount)) {
    return Math.round(amount * 10 ** exponent);
  }
  if (typeof amount === "string" && /^\d+(\.\d{1,4})?$/.test(amount.trim())) {
    const [whole, frac = ""] = amount.trim().split(".");
    return Number(whole) * 10 ** exponent + Number((frac + "0000").slice(0, exponent));
  }
  return null;
}
