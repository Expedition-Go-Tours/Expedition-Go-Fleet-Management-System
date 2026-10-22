import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/errors";
import {
  reachableStates,
  resolveAction,
  transitionAllowed,
  type ActionMap,
} from "@/lib/domain/lifecycle";
import { REPORT_ACTIONS, type ReportStatus } from "@/lib/domain/report";
import {
  VEHICLE_STATUS_ACTIONS,
  releaseBlockReason,
  VEHICLE_STATUSES,
  type VehicleStatus,
} from "@/lib/domain/vehicle";
import { WORK_ORDER_ACTIONS, type WorkOrderStatus } from "@/lib/domain/work-order";
import {
  EXPENSE_ACTIONS,
  EXPENSE_STATUSES,
  isValidAmountMinor,
  toPesewas,
  type ExpenseStatus,
} from "@/lib/domain/expense";
import { PERMISSIONS } from "@/lib/auth/permissions";

const VEHICLES = VEHICLE_STATUS_ACTIONS as ActionMap<VehicleStatus>;
const REPORTS = REPORT_ACTIONS as ActionMap<ReportStatus>;
const WORK_ORDERS = WORK_ORDER_ACTIONS as ActionMap<WorkOrderStatus>;
const EXPENSES = EXPENSE_ACTIONS as ActionMap<ExpenseStatus>;

describe("lifecycle resolveAction", () => {
  it("resolves a known action", () => {
    const result = resolveAction(VEHICLES, "release");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.def.to).toBe("ACTIVE");
  });

  it("rejects an unknown action", () => {
    const result = resolveAction(VEHICLES, "destroy");
    expect(result).toEqual({ ok: false, error: "unknown_action" });
  });
});

describe("vehicle status machine (§6.5 safety-hold invariant)", () => {
  it("release is only valid from SAFETY_HOLD", () => {
    const result = resolveAction(VEHICLES, "release");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(transitionAllowed(result.def, "SAFETY_HOLD")).toBe(true);
      expect(transitionAllowed(result.def, "ACTIVE")).toBe(false);
      expect(transitionAllowed(result.def, "ARCHIVED")).toBe(false);
    }
  });

  it("archive is unreachable from ARCHIVED (terminal state)", () => {
    expect(reachableStates(VEHICLES, "ARCHIVED")).toHaveLength(0);
  });

  it("no action can resurrect an archived vehicle", () => {
    for (const def of Object.values(VEHICLES)) {
      expect((def.from as readonly string[]).includes("ARCHIVED")).toBe(false);
    }
  });

  it("release requires the dedicated admin permission, not the routine status permission", () => {
    const result = resolveAction(VEHICLES, "release");
    if (result.ok) {
      expect(result.def.permission).toBe(PERMISSIONS.VEHICLE_RELEASE);
      expect(result.def.permission).not.toBe(PERMISSIONS.VEHICLE_STATUS_UPDATE);
    }
  });

  it("refuses release while any critical safety issue is open", () => {
    expect(releaseBlockReason(1)).toContain("1 open critical issue");
    expect(releaseBlockReason(3)).toContain("3 open critical issue");
    expect(releaseBlockReason(0)).toBeNull();
  });

  it("fails closed when the critical-issue count is unknown", () => {
    expect(releaseBlockReason(-1)).not.toBeNull();
    expect(releaseBlockReason(Number.NaN)).not.toBeNull();
    expect(releaseBlockReason(1.5)).not.toBeNull();
  });

  it("every vehicle status is reachable from some action", () => {
    const targets = new Set(Object.values(VEHICLES).map((def) => def.to));
    for (const status of VEHICLE_STATUSES) {
      expect(targets.has(status)).toBe(true);
    }
  });
});

describe("issue lifecycle", () => {
  it("triage only from OPEN", () => {
    const result = resolveAction(REPORTS, "triage");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(transitionAllowed(result.def, "OPEN")).toBe(true);
      expect(transitionAllowed(result.def, "TRIAGED")).toBe(false);
      expect(transitionAllowed(result.def, "CLOSED")).toBe(false);
    }
  });

  it("close is valid from OPEN or TRIAGED, never from CLOSED", () => {
    const result = resolveAction(REPORTS, "close");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(transitionAllowed(result.def, "OPEN")).toBe(true);
      expect(transitionAllowed(result.def, "TRIAGED")).toBe(true);
      expect(transitionAllowed(result.def, "CLOSED")).toBe(false);
    }
  });
});

describe("work order lifecycle", () => {
  it("is a forward pipeline with waiting, verification and explicit reopen", () => {
    expect(transitionAllowed(WORK_ORDERS.start!, "OPEN")).toBe(true);
    expect(transitionAllowed(WORK_ORDERS.start!, "IN_PROGRESS")).toBe(false);
    expect(transitionAllowed(WORK_ORDERS.wait!, "IN_PROGRESS")).toBe(true);
    expect(transitionAllowed(WORK_ORDERS.wait!, "OPEN")).toBe(false);
    expect(transitionAllowed(WORK_ORDERS.resume!, "WAITING")).toBe(true);
    expect(transitionAllowed(WORK_ORDERS.verify!, "COMPLETED")).toBe(true);
    expect(transitionAllowed(WORK_ORDERS.verify!, "IN_PROGRESS")).toBe(false);
    expect(transitionAllowed(WORK_ORDERS.close!, "VERIFIED")).toBe(true);
    expect(transitionAllowed(WORK_ORDERS.close!, "IN_PROGRESS")).toBe(false);
    expect(transitionAllowed(WORK_ORDERS.reopen!, "CLOSED")).toBe(true);
    expect(transitionAllowed(WORK_ORDERS.reopen!, "COMPLETED")).toBe(false);
  });
});

describe("expense model (recorded in-app, corrected in-app, no approval step)", () => {
  it("has void and no other lifecycle action", () => {
    expect(Object.keys(EXPENSES)).toEqual(["void"]);
  });

  it("void is valid from a freshly recorded or legacy approved cost", () => {
    const result = resolveAction(EXPENSES, "void");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(transitionAllowed(result.def, "PENDING")).toBe(true);
      expect(transitionAllowed(result.def, "APPROVED")).toBe(true);
      expect(transitionAllowed(result.def, "REJECTED")).toBe(false);
      expect(transitionAllowed(result.def, "VOID")).toBe(false);
    }
  });

  it("voiding is permission-gated", () => {
    const voidIt = resolveAction(EXPENSES, "void");
    if (voidIt.ok) {
      expect(voidIt.def.permission).toBe(PERMISSIONS.EXPENSE_VOID);
    }
  });

  it("no action can reach a terminal state from itself (no loops)", () => {
    for (const [name, def] of Object.entries(EXPENSES)) {
      expect(transitionAllowed(def, def.to), `${name} → ${def.to}`).toBe(false);
    }
  });

  it("every action lands on a real status", () => {
    for (const def of Object.values(EXPENSES)) {
      expect(EXPENSE_STATUSES as readonly string[]).toContain(def.to);
      for (const from of def.from) {
        expect(EXPENSE_STATUSES as readonly string[]).toContain(from);
      }
    }
  });

  it("amountMinor must be a positive safe integer within bounds", () => {
    expect(isValidAmountMinor(1)).toBe(true);
    expect(isValidAmountMinor(125_50)).toBe(true);
    expect(isValidAmountMinor(0)).toBe(false);
    expect(isValidAmountMinor(-100)).toBe(false);
    expect(isValidAmountMinor(10.5)).toBe(false);
    expect(isValidAmountMinor("500")).toBe(false);
  });

  it("toPesewas converts without float drift", () => {
    expect(toPesewas("250.50")).toBe(25050);
    expect(toPesewas("0.07")).toBe(7);
    expect(toPesewas("1234.56")).toBe(123456);
    expect(toPesewas(250.5)).toBe(25050);
    expect(toPesewas("not-a-price")).toBeNull();
  });
});

describe("ApiError shape used by routes", () => {
  it("409 conflict carries a code", () => {
    const err = ApiError.conflict("Invalid state");
    expect(err.status).toBe(409);
    expect(err.code).toBe("CONFLICT");
  });
});
