import { describe, expect, it } from "vitest";

import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  availableExpenseActions,
  expenseMatchesLedger,
  expenseMatchesTotals,
  expenseStatusLabel,
  EXPENSE_ACTIONS,
  IN_APP_EXPENSE_ACTIONS,
  isCountedExpense,
  isValidAmountMinor,
  MAX_PAID_TO_LENGTH,
  normalizeExpenseStatus,
  parsePaidTo,
  summarizeExpenses,
  toPesewas,
  type Expense,
  type ExpenseSummaryRow,
} from "@/lib/domain/expense";

describe("expense money — integer minor units, no float drift", () => {
  it("converts major-unit strings exactly", () => {
    expect(toPesewas("250.00")).toBe(25000);
    expect(toPesewas("0.05")).toBe(5);
    expect(toPesewas("1000")).toBe(100000);
    expect(toPesewas("12.5")).toBe(1250);
  });

  it("avoids binary float drift that Math.round(x*100) can introduce", () => {
    // 0.29 * 100 = 28.999999999999996 in IEEE-754; the string path must give 29.
    expect(toPesewas("0.29")).toBe(29);
    expect(toPesewas("19.99")).toBe(1999);
  });

  it("rounds numeric input to the nearest minor unit", () => {
    expect(toPesewas(250)).toBe(25000);
    expect(toPesewas(0.1)).toBe(10);
  });

  it("rejects non-numeric, negative and malformed input with null", () => {
    expect(toPesewas("abc")).toBeNull();
    expect(toPesewas("-5")).toBeNull();
    expect(toPesewas("1.23456")).toBeNull();
    expect(toPesewas(Number.NaN)).toBeNull();
    expect(toPesewas(null)).toBeNull();
    expect(toPesewas(undefined)).toBeNull();
  });

  it("isValidAmountMinor requires positive safe integers within the cap", () => {
    expect(isValidAmountMinor(1)).toBe(true);
    expect(isValidAmountMinor(100_000_000_00)).toBe(true);
    expect(isValidAmountMinor(0)).toBe(false);
    expect(isValidAmountMinor(-1)).toBe(false);
    expect(isValidAmountMinor(1.5)).toBe(false);
    expect(isValidAmountMinor(100_000_000_01)).toBe(false);
    expect(isValidAmountMinor("100")).toBe(false);
    expect(isValidAmountMinor(Number.NaN)).toBe(false);
  });
});

describe("expense actions — recorded in-app, corrected in-app, no approval step", () => {
  it("offers VOID as the only in-app action", () => {
    expect(IN_APP_EXPENSE_ACTIONS).toEqual(["void"]);
  });

  it("offers VOID immediately on a newly recorded expense", () => {
    expect(availableExpenseActions("PENDING", [PERMISSIONS.EXPENSE_VOID])).toEqual(["void"]);
  });

  it("keeps VOID available for legacy approved rows", () => {
    expect(availableExpenseActions("APPROVED", [PERMISSIONS.EXPENSE_VOID])).toEqual(["void"]);
  });

  it("does not offer a correction to someone without expense:void", () => {
    expect(availableExpenseActions("PENDING", [PERMISSIONS.EXPENSE_CREATE])).toEqual([]);
    expect(availableExpenseActions("PENDING", [PERMISSIONS.EXPENSE_READ])).toEqual([]);
  });

  it("does not act on a terminal state", () => {
    expect(availableExpenseActions("VOID", [PERMISSIONS.EXPENSE_VOID])).toEqual([]);
    expect(availableExpenseActions("REJECTED", [PERMISSIONS.EXPENSE_VOID])).toEqual([]);
  });

  it("has no approve or reject action left in the lifecycle map", () => {
    expect(Object.keys(EXPENSE_ACTIONS)).toEqual(["void"]);
    expect(EXPENSE_ACTIONS.void.from).toEqual(["PENDING", "APPROVED"]);
    expect(EXPENSE_ACTIONS.void.permission).toBe(PERMISSIONS.EXPENSE_VOID);
  });

  it("every in-app action exists in the lifecycle map", () => {
    for (const action of IN_APP_EXPENSE_ACTIONS) {
      expect(EXPENSE_ACTIONS).toHaveProperty(action);
    }
  });
});

describe("expense presentation — no approval vocabulary", () => {
  it("labels recorded and legacy rows without approval language", () => {
    expect(expenseStatusLabel("PENDING")).toBe("Recorded");
    expect(expenseStatusLabel("APPROVED")).toBe("Recorded");
    expect(expenseStatusLabel("VOID")).toBe("Voided");
    expect(expenseStatusLabel("REJECTED")).toBe("Excluded");
  });

  it("counts recorded and legacy approved rows, never voided or excluded ones", () => {
    expect(isCountedExpense("PENDING")).toBe(true);
    expect(isCountedExpense("APPROVED")).toBe(true);
    expect(isCountedExpense("VOID")).toBe(false);
    expect(isCountedExpense("REJECTED")).toBe(false);
  });

  it("maps legacy stored statuses without losing or inventing data", () => {
    expect(normalizeExpenseStatus("RECORDED")).toBe("PENDING");
    expect(normalizeExpenseStatus("PENDING")).toBe("PENDING");
    expect(normalizeExpenseStatus("APPROVED")).toBe("APPROVED");
    expect(normalizeExpenseStatus("REJECTED")).toBe("REJECTED");
    expect(normalizeExpenseStatus("VOID")).toBe("VOID");
    expect(normalizeExpenseStatus(undefined)).toBe("PENDING");
    expect(normalizeExpenseStatus("PAID")).toBe("PENDING");
  });
});

describe("summarizeExpenses — practical totals for a small team", () => {
  const now = new Date(2026, 9, 22); // 22 Oct 2026, local
  const rows: ExpenseSummaryRow[] = [
    {
      amountMinor: 25000,
      category: "MAINTENANCE",
      vehicleId: "veh_1",
      status: "PENDING",
      incurredOn: new Date(2026, 9, 20),
    },
    {
      amountMinor: 5000,
      category: "FUEL",
      vehicleId: "veh_2",
      status: "APPROVED",
      incurredOn: new Date(2026, 9, 2),
    },
    {
      amountMinor: 9000,
      category: "MAINTENANCE",
      vehicleId: "veh_1",
      status: "PENDING",
      incurredOn: new Date(2026, 8, 30),
    },
    {
      amountMinor: 40000,
      category: "MAINTENANCE",
      vehicleId: "veh_1",
      status: "VOID",
      incurredOn: new Date(2026, 9, 21),
    },
    {
      amountMinor: 30000,
      category: "PARTS",
      vehicleId: "veh_2",
      status: "REJECTED",
      incurredOn: new Date(2026, 9, 21),
    },
  ];

  it("totals only recorded cost, with this month separated", () => {
    const summary = summarizeExpenses(rows, now);
    expect(summary.count).toBe(3);
    expect(summary.countedMinor).toBe(39000);
    expect(summary.monthMinor).toBe(30000);
  });

  it("breaks cost down by category and vehicle, largest first", () => {
    const summary = summarizeExpenses(rows, now);
    expect(summary.byCategory).toEqual([
      { key: "MAINTENANCE", count: 2, amountMinor: 34000 },
      { key: "FUEL", count: 1, amountMinor: 5000 },
    ]);
    expect(summary.byVehicle).toEqual([
      { key: "veh_1", count: 2, amountMinor: 34000 },
      { key: "veh_2", count: 1, amountMinor: 5000 },
    ]);
  });

  it("handles an empty ledger", () => {
    expect(summarizeExpenses([], now)).toEqual({
      count: 0,
      countedMinor: 0,
      monthMinor: 0,
      byCategory: [],
      byVehicle: [],
    });
  });
});

describe("parsePaidTo — optional payee on a recorded payment", () => {
  it("treats absent and blank values as 'not recorded', never empty text", () => {
    expect(parsePaidTo(undefined)).toEqual({ ok: true });
    expect(parsePaidTo(null)).toEqual({ ok: true });
    expect(parsePaidTo("   ")).toEqual({ ok: true });
  });

  it("trims a real name", () => {
    expect(parsePaidTo("  Kofi Mensah  ")).toEqual({ ok: true, paidTo: "Kofi Mensah" });
  });

  it("rejects non-text values and names over the shared limit", () => {
    expect(parsePaidTo(42)).toEqual({ ok: false, message: "paidTo must be text" });
    expect(parsePaidTo("x".repeat(MAX_PAID_TO_LENGTH + 1))).toEqual({
      ok: false,
      message: `paidTo must be ${MAX_PAID_TO_LENGTH} characters or fewer`,
    });
  });
});

describe("expense ledger filters — the page and the export share one predicate", () => {
  const expense = (overrides: Partial<Expense> = {}): Expense => {
    const now = new Date("2026-10-12T12:00:00Z");
    return {
      id: "exp_1",
      vehicleId: "veh_1",
      category: "FUEL",
      amountMinor: 500_00,
      currency: "GHS",
      description: "Fill",
      incurredOn: new Date("2026-10-12T12:00:00Z"),
      status: "PENDING",
      createdBy: "user_1",
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  };

  it("narrows the visible ledger by category, vehicle and period", () => {
    expect(expenseMatchesLedger(expense(), {})).toBe(true);
    expect(expenseMatchesLedger(expense(), { category: "FUEL" })).toBe(true);
    expect(expenseMatchesLedger(expense(), { category: "TYRES" })).toBe(false);
    expect(expenseMatchesLedger(expense(), { vehicleId: "veh_2" })).toBe(false);

    const range = { from: "2026-10-12", to: "2026-10-18" };
    expect(expenseMatchesLedger(expense(), { range })).toBe(true);
    expect(
      expenseMatchesLedger(expense({ incurredOn: new Date("2026-10-19T12:00:00Z") }), { range }),
    ).toBe(false);
    expect(
      expenseMatchesLedger(expense({ incurredOn: new Date("2026-10-18T23:59:00Z") }), { range }),
    ).toBe(true);
  });

  it("keeps category out of the totals predicate — the page's documented rule", () => {
    // The totals predicate has no category dimension at all: category narrows
    // the visible ledger only, so a TYRES row still counts toward the totals
    // for the chosen vehicle and period.
    expect(expenseMatchesTotals(expense({ category: "TYRES" }), {})).toBe(true);
    expect(expenseMatchesTotals(expense({ category: "TYRES" }), { vehicleId: "veh_1" })).toBe(true);
  });

  it("honours vehicle and period in the totals predicate", () => {
    expect(expenseMatchesTotals(expense(), { vehicleId: "veh_1" })).toBe(true);
    expect(expenseMatchesTotals(expense(), { vehicleId: "veh_2" })).toBe(false);
    expect(
      expenseMatchesTotals(expense({ incurredOn: new Date("2026-09-30T12:00:00Z") }), {
        range: { from: "2026-10-01", to: "2026-10-31" },
      }),
    ).toBe(false);
  });
});
