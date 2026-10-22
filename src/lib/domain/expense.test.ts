import { describe, expect, it } from "vitest";

import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  availableExpenseActions,
  EXPENSE_ACTIONS,
  IN_APP_EXPENSE_ACTIONS,
  isValidAmountMinor,
  toPesewas,
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

describe("expense actions — recorded in-app, approved outside", () => {
  it("offers VOID as the only in-app action", () => {
    expect(IN_APP_EXPENSE_ACTIONS).toEqual(["void"]);
  });

  it("never offers approve or reject, even to someone allowed to approve", () => {
    // Someone with expense:approve still sees no approval button on PENDING:
    // approval is an external decision applied through the API.
    expect(availableExpenseActions("PENDING", [PERMISSIONS.EXPENSE_APPROVE])).toEqual([]);
    // Same for the VOID permission holder on a pending record.
    expect(availableExpenseActions("PENDING", [PERMISSIONS.EXPENSE_VOID])).toEqual([]);
  });

  it("offers VOID on an approved cost to a holder of expense:void only", () => {
    expect(availableExpenseActions("APPROVED", [PERMISSIONS.EXPENSE_VOID])).toEqual(["void"]);
  });

  it("does not let an approver void, nor a voider act on a terminal state", () => {
    expect(availableExpenseActions("APPROVED", [PERMISSIONS.EXPENSE_APPROVE])).toEqual([]);
    expect(availableExpenseActions("VOID", [PERMISSIONS.EXPENSE_VOID])).toEqual([]);
  });

  it("keeps approve/reject in the API action map for the external approver", () => {
    // The UI rule above must not become an API regression: an external process
    // still drives approval through these permission-gated actions.
    expect(Object.keys(EXPENSE_ACTIONS).sort()).toEqual(["approve", "reject", "void"]);
    expect(EXPENSE_ACTIONS.approve.permission).toBe(PERMISSIONS.EXPENSE_APPROVE);
    expect(EXPENSE_ACTIONS.reject.permission).toBe(PERMISSIONS.EXPENSE_APPROVE);
  });

  it("every in-app action exists in the lifecycle map", () => {
    for (const action of IN_APP_EXPENSE_ACTIONS) {
      expect(EXPENSE_ACTIONS).toHaveProperty(action);
    }
  });
});
