import { PERMISSIONS } from "@/lib/auth/permissions";
import type { ActionMap } from "@/lib/domain/lifecycle";

/*
 * Expense domain model.
 *
 * Expenses are RECORDED here; approval happens outside this system. New rows
 * are stored as `PENDING` for backward compatibility with historical data and
 * are presented as "Recorded" — there is no in-app approval step. The only
 * in-app correction is a void (with a reason) of a recorded cost, available
 * immediately after recording. A recorded expense is a fact — nothing is ever
 * deleted. Money is stored as integer pesewas — never floats.
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
 *   PENDING  -> VOID  (expense:void, reason required — correct a mistake)
 *   APPROVED -> VOID  (legacy approved rows keep the same correction path)
 *
 * `PENDING` is retained as the stored status for a newly recorded expense so
 * historical data and older clients keep working; it means "recorded", not
 * "waiting for approval". APPROVED/REJECTED are legacy states from the former
 * approval process and are still read (and excluded/counted) consistently.
 * PENDING and APPROVED are counted in reports; REJECTED and VOID are excluded.
 * The transitions are enforced server-side; see
 * src/app/api/v1/expenses/[id]/status/route.ts.
 */
export const EXPENSE_ACTIONS = {
  void: {
    permission: PERMISSIONS.EXPENSE_VOID,
    from: ["PENDING", "APPROVED"],
    to: "VOID",
  },
} as const satisfies ActionMap<ExpenseStatus>;

/**
 * The only expense actions a screen may offer.
 *
 * Business rule: the app records expenses and approval happens outside it, so
 * `void` is the single in-app correction and always needs a reason.
 */
export const IN_APP_EXPENSE_ACTIONS = ["void"] as const;

/** Statuses that count as real, recorded cost. */
export function isCountedExpense(status: ExpenseStatus): boolean {
  return status === "PENDING" || status === "APPROVED";
}

/**
 * Map a stored status onto the current model, backward-compatibly:
 *  - legacy `RECORDED` (pre-approval data) → `PENDING` (both mean recorded)
 *  - known statuses are preserved (legacy APPROVED/REJECTED keep meaning)
 *  - anything unrecognised falls back to `PENDING`, never an invalid state.
 */
export function normalizeExpenseStatus(raw: unknown): ExpenseStatus {
  const status = raw == null ? "" : String(raw);
  if (status === "RECORDED") return "PENDING";
  return (EXPENSE_STATUSES as readonly string[]).includes(status)
    ? (status as ExpenseStatus)
    : "PENDING";
}

/**
 * Display label for a stored status — never the approval vocabulary that the
 * business process does not use in this app.
 *  - PENDING / APPROVED → Recorded (legacy approvals are simply recorded cost)
 *  - REJECTED           → Excluded (legacy data; never counted)
 *  - VOID               → Voided
 */
export function expenseStatusLabel(status: ExpenseStatus): "Recorded" | "Voided" | "Excluded" {
  if (status === "VOID") return "Voided";
  if (status === "REJECTED") return "Excluded";
  return "Recorded";
}

export interface ExpenseSummaryRow {
  amountMinor: number;
  category: string;
  vehicleId: string;
  status: ExpenseStatus;
  incurredOn: Date;
}

export interface ExpenseBreakdownRow {
  key: string;
  count: number;
  amountMinor: number;
}

/**
 * Practical totals for a small team: recorded cost, this month's cost, and
 * where the money went by category and vehicle. Only counted rows contribute;
 * voided/excluded rows stay visible in the ledger but never in a total.
 */
export function summarizeExpenses(
  rows: readonly ExpenseSummaryRow[],
  now: Date = new Date(),
): {
  count: number;
  countedMinor: number;
  monthMinor: number;
  byCategory: ExpenseBreakdownRow[];
  byVehicle: ExpenseBreakdownRow[];
} {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const counted = rows.filter((row) => isCountedExpense(row.status));

  const group = (keyOf: (row: ExpenseSummaryRow) => string): ExpenseBreakdownRow[] => {
    const map = new Map<string, ExpenseBreakdownRow>();
    for (const row of counted) {
      const key = keyOf(row);
      const existing = map.get(key) ?? { key, count: 0, amountMinor: 0 };
      existing.count += 1;
      existing.amountMinor += row.amountMinor;
      map.set(key, existing);
    }
    return [...map.values()].sort(
      (a, b) => b.amountMinor - a.amountMinor || a.key.localeCompare(b.key),
    );
  };

  return {
    count: counted.length,
    countedMinor: counted.reduce((sum, row) => sum + row.amountMinor, 0),
    monthMinor: counted
      .filter((row) => row.incurredOn >= monthStart)
      .reduce((sum, row) => sum + row.amountMinor, 0),
    byCategory: group((row) => row.category),
    byVehicle: group((row) => row.vehicleId),
  };
}

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
