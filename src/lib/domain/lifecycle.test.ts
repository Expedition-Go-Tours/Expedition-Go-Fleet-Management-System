import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/errors";
import { reachableStates, resolveAction, transitionAllowed } from "@/lib/domain/lifecycle";
import { REPORT_ACTIONS } from "@/lib/domain/report";
import { VEHICLE_STATUS_ACTIONS, VEHICLE_STATUSES } from "@/lib/domain/vehicle";
import { WORK_ORDER_ACTIONS } from "@/lib/domain/work-order";
import { EXPENSE_ACTIONS, isValidAmountMinor } from "@/lib/domain/expense";

describe("lifecycle resolveAction", () => {
  it("resolves a known action", () => {
    const result = resolveAction(VEHICLE_STATUS_ACTIONS, "release");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.def.to).toBe("ACTIVE");
  });

  it("rejects an unknown action", () => {
    const result = resolveAction(VEHICLE_STATUS_ACTIONS, "destroy");
    expect(result).toEqual({ ok: false, error: "unknown_action" });
  });
});

describe("vehicle status machine (§6.5 safety-hold invariant)", () => {
  it("release is only valid from SAFETY_HOLD", () => {
    const result = resolveAction(VEHICLE_STATUS_ACTIONS, "release");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(transitionAllowed(result.def, "SAFETY_HOLD")).toBe(true);
      expect(transitionAllowed(result.def, "ACTIVE")).toBe(false);
      expect(transitionAllowed(result.def, "IN_SERVICE")).toBe(false);
      expect(transitionAllowed(result.def, "ARCHIVED")).toBe(false);
    }
  });

  it("archive is unreachable from ARCHIVED (terminal state)", () => {
    expect(reachableStates(VEHICLE_STATUS_ACTIONS, "ARCHIVED")).toHaveLength(0);
  });

  it("no action can resurrect an archived vehicle", () => {
    for (const def of Object.values(VEHICLE_STATUS_ACTIONS)) {
      expect((def.from as readonly string[]).includes("ARCHIVED")).toBe(false);
    }
  });

  it("safety_hold cannot be placed on an already held vehicle", () => {
    const result = resolveAction(VEHICLE_STATUS_ACTIONS, "safety_hold");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(transitionAllowed(result.def, "SAFETY_HOLD")).toBe(false);
      expect(transitionAllowed(result.def, "ACTIVE")).toBe(true);
      expect(transitionAllowed(result.def, "IN_SERVICE")).toBe(true);
    }
  });

  it("every vehicle status is reachable from some action", () => {
    const targets = new Set(Object.values(VEHICLE_STATUS_ACTIONS).map((def) => def.to));
    for (const status of VEHICLE_STATUSES) {
      expect(targets.has(status)).toBe(true);
    }
  });
});

describe("report lifecycle", () => {
  it("triage only from OPEN", () => {
    const result = resolveAction(REPORT_ACTIONS, "triage");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(transitionAllowed(result.def, "OPEN")).toBe(true);
      expect(transitionAllowed(result.def, "TRIAGED")).toBe(false);
      expect(transitionAllowed(result.def, "CLOSED")).toBe(false);
    }
  });

  it("close is valid from OPEN or TRIAGED, never from CLOSED", () => {
    const result = resolveAction(REPORT_ACTIONS, "close");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(transitionAllowed(result.def, "OPEN")).toBe(true);
      expect(transitionAllowed(result.def, "TRIAGED")).toBe(true);
      expect(transitionAllowed(result.def, "CLOSED")).toBe(false);
    }
  });
});

describe("work order lifecycle", () => {
  it("is a strict forward pipeline with an explicit reopen", () => {
    expect(transitionAllowed(WORK_ORDER_ACTIONS.start!, "OPEN")).toBe(true);
    expect(transitionAllowed(WORK_ORDER_ACTIONS.start!, "IN_PROGRESS")).toBe(false);
    expect(transitionAllowed(WORK_ORDER_ACTIONS.complete!, "IN_PROGRESS")).toBe(true);
    expect(transitionAllowed(WORK_ORDER_ACTIONS.complete!, "OPEN")).toBe(false);
    expect(transitionAllowed(WORK_ORDER_ACTIONS.close!, "COMPLETED")).toBe(true);
    expect(transitionAllowed(WORK_ORDER_ACTIONS.close!, "IN_PROGRESS")).toBe(false);
    expect(transitionAllowed(WORK_ORDER_ACTIONS.reopen!, "CLOSED")).toBe(true);
    expect(transitionAllowed(WORK_ORDER_ACTIONS.reopen!, "COMPLETED")).toBe(false);
  });
});

describe("expense lifecycle + amounts", () => {
  it("approval and payment follow the financial chain", () => {
    expect(transitionAllowed(EXPENSE_ACTIONS.approve!, "PENDING")).toBe(true);
    expect(transitionAllowed(EXPENSE_ACTIONS.approve!, "APPROVED")).toBe(false);
    expect(transitionAllowed(EXPENSE_ACTIONS.mark_paid!, "APPROVED")).toBe(true);
    expect(transitionAllowed(EXPENSE_ACTIONS.mark_paid!, "PENDING")).toBe(false);
  });

  it("VOID and PAID are terminal", () => {
    for (const def of Object.values(EXPENSE_ACTIONS)) {
      const from = def.from as readonly string[];
      expect(from.includes("PAID")).toBe(false);
      expect(from.includes("VOID")).toBe(false);
    }
  });

  it("voiding is only allowed pre-settlement", () => {
    const result = resolveAction(EXPENSE_ACTIONS, "void");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(transitionAllowed(result.def, "PENDING")).toBe(true);
      expect(transitionAllowed(result.def, "APPROVED")).toBe(true);
      expect(transitionAllowed(result.def, "PAID")).toBe(false);
    }
  });

  it("amountMinor must be a positive safe integer within bounds", () => {
    expect(isValidAmountMinor(1)).toBe(true);
    expect(isValidAmountMinor(125_50)).toBe(true);
    expect(isValidAmountMinor(0)).toBe(false);
    expect(isValidAmountMinor(-100)).toBe(false);
    expect(isValidAmountMinor(10.5)).toBe(false);
    expect(isValidAmountMinor(100_000_000_01)).toBe(false);
    expect(isValidAmountMinor("500")).toBe(false);
  });
});

describe("ApiError shape used by routes", () => {
  it("409 conflict carries a code", () => {
    const err = ApiError.conflict("Invalid state");
    expect(err.status).toBe(409);
    expect(err.code).toBe("CONFLICT");
  });
});
