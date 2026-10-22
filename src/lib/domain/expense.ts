import { PERMISSIONS } from "@/lib/auth/permissions";
import type { ActionMap } from "@/lib/domain/lifecycle";

/*
 * Expense domain model.
 *
 * Approval happens OUTSIDE this system. The app records an expense as PENDING;
 * an external approver (Operations/Admin via the API, or their own process)
 * applies APPROVED or REJECTED. The approve/reject actions stay in the action
 * map so that integration can drive them, but no screen offers them — the only
 * in-app correction is a void (with a reason) of an approved cost. A recorded
 * expense is a fact — nothing is ever deleted. Money is stored as integer
 * pesewas — never floats.
 */

export const EXPENSE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "VOID"] as const;
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
  /** Who signed the expense off (or rejected it), and when. */
  approvedBy?: string;
  approvedAt?: Date;
  rejectedBy?: string;
  rejectedAt?: Date;
  rejectReason?: string;
  voidedBy?: string;
  voidedAt?: string;
  voidReason?: string;
}

/**
 * Expense lifecycle (see FLEET_WORKFLOWS.md §7.3).
 *
 * A new expense is PENDING until an approver signs it off:
 *   PENDING  -> APPROVED  (expense:approve)
 *   PENDING  -> REJECTED  (expense:approve, reason required)
 *   APPROVED -> VOID      (expense:void, reason required — reverses the cost)
 *
 * PENDING and APPROVED are counted in reports; REJECTED and VOID are excluded.
 * The transitions are enforced server-side; see
 * src/app/api/v1/expenses/[id]/status/route.ts.
 */
export const EXPENSE_ACTIONS = {
  approve: {
    permission: PERMISSIONS.EXPENSE_APPROVE,
    from: ["PENDING"],
    to: "APPROVED",
  },
  reject: {
    permission: PERMISSIONS.EXPENSE_APPROVE,
    from: ["PENDING"],
    to: "REJECTED",
  },
  void: {
    permission: PERMISSIONS.EXPENSE_VOID,
    from: ["APPROVED"],
    to: "VOID",
  },
} as const satisfies ActionMap<ExpenseStatus>;

/**
 * The only expense actions a screen may offer.
 *
 * Business rule: the app records expenses and approval happens outside it, so
 * `approve`/`reject` are API capability for the external approver — never UI
 * steps. `void` is the single in-app correction and always needs a reason.
 */
export const IN_APP_EXPENSE_ACTIONS = ["void"] as const;

/**
 * In-app actions available for an expense right now: the record-only rule
 * applied first, then the lifecycle (`from`) and the caller's permissions.
 * Returns action names, in action-map order, so callers own presentation.
 */
export function availableExpenseActions(
  status: ExpenseStatus,
  permissions: readonly string[],
): string[] {
  return Object.entries(EXPENSE_ACTIONS)
    .filter(([action]) => (IN_APP_EXPENSE_ACTIONS as readonly string[]).includes(action))
    .filter(
      ([, def]) =>
        (def.from as readonly string[]).includes(status) && permissions.includes(def.permission),
    )
    .map(([action]) => action);
}

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
