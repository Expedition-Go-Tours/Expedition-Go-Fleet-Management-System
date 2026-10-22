import { describe, expect, it } from "vitest";

import {
  buildServiceExpenseRecord,
  recordServiceCost,
  serviceExpenseId,
  ServiceCostError,
  type ServiceCostInput,
  type ServiceCostPorts,
  type ServiceExpenseRecord,
} from "@/lib/domain/service-cost";

const input: ServiceCostInput = {
  serviceRecordId: "svc_record_1",
  vehicleId: "veh_1",
  workOrderId: "wo_1",
  amountMinor: 25000,
  currency: "ghs",
  description: "  Replace front brake pads  ",
  supplierName: "Kofi Auto Parts",
  incurredOn: new Date("2026-10-19T10:00:00Z"),
  createdBy: "user_1",
};

function fakeLedger(options?: { failEnsure?: number; failLink?: number }) {
  const expenses = new Map<string, ServiceExpenseRecord>();
  const links: { serviceRecordId: string; expenseId: string }[] = [];
  let failEnsure = options?.failEnsure ?? 0;
  let failLink = options?.failLink ?? 0;

  const ports: ServiceCostPorts = {
    ensureExpense: async (record) => {
      // Yield once so concurrent callers interleave like real requests.
      await Promise.resolve();
      if (failEnsure > 0) {
        failEnsure -= 1;
        throw new Error("expense write failed");
      }
      if (expenses.has(record.id)) return { expenseId: record.id, created: false };
      expenses.set(record.id, record);
      return { expenseId: record.id, created: true };
    },
    linkServiceRecord: async (serviceRecordId, expenseId) => {
      if (failLink > 0) {
        failLink -= 1;
        throw new Error("link write failed");
      }
      links.push({ serviceRecordId, expenseId });
    },
  };

  return { expenses, links, ports };
}

describe("serviceExpenseId — one monetary record per service record", () => {
  it("is deterministic and scoped to the service record", () => {
    expect(serviceExpenseId("svc_record_1")).toBe("svc_svc_record_1");
    expect(serviceExpenseId("svc_record_1")).toBe(serviceExpenseId("svc_record_1"));
    expect(serviceExpenseId("svc_record_2")).not.toBe(serviceExpenseId("svc_record_1"));
  });

  it("refuses an empty or path-like id instead of producing an invalid document id", () => {
    expect(() => serviceExpenseId("  ")).toThrow(ServiceCostError);
    expect(() => serviceExpenseId("a/b")).toThrow(ServiceCostError);
  });
});

describe("buildServiceExpenseRecord — canonical MAINTENANCE expense", () => {
  it("uses the deterministic id and normalises the descriptive fields", () => {
    expect(buildServiceExpenseRecord(input)).toMatchObject({
      id: "svc_svc_record_1",
      vehicleId: "veh_1",
      workOrderId: "wo_1",
      serviceRecordId: "svc_record_1",
      category: "MAINTENANCE",
      amountMinor: 25000,
      currency: "GHS",
      description: "Replace front brake pads",
      supplierName: "Kofi Auto Parts",
      createdBy: "user_1",
    });
  });

  it("rejects a non-positive or fractional amount", () => {
    expect(() => buildServiceExpenseRecord({ ...input, amountMinor: 0 })).toThrow(ServiceCostError);
    expect(() => buildServiceExpenseRecord({ ...input, amountMinor: 10.5 })).toThrow(
      ServiceCostError,
    );
  });

  it("rejects a malformed currency", () => {
    expect(() => buildServiceExpenseRecord({ ...input, currency: "cedis" })).toThrow(
      ServiceCostError,
    );
  });
});

describe("recordServiceCost — recoverable, idempotent cost linking", () => {
  it("creates exactly one expense and links it on success", async () => {
    const ledger = fakeLedger();
    const result = await recordServiceCost(ledger.ports, input);

    expect(result).toEqual({ expenseId: "svc_svc_record_1", created: true });
    expect(ledger.expenses.size).toBe(1);
    expect(ledger.expenses.get("svc_svc_record_1")?.amountMinor).toBe(25000);
    expect(ledger.links).toEqual([
      { serviceRecordId: "svc_record_1", expenseId: "svc_svc_record_1" },
    ]);
  });

  it("does not pretend success when the expense write fails", async () => {
    const ledger = fakeLedger({ failEnsure: 1 });
    await expect(recordServiceCost(ledger.ports, input)).rejects.toThrow("expense write failed");
    expect(ledger.expenses.size).toBe(0);
    expect(ledger.links).toEqual([]);
  });

  it("recovers when the expense write itself failed before anything was created", async () => {
    const ledger = fakeLedger({ failEnsure: 1 });

    await expect(recordServiceCost(ledger.ports, input)).rejects.toThrow("expense write failed");
    expect(ledger.expenses.size).toBe(0);

    const retry = await recordServiceCost(ledger.ports, input);
    expect(retry).toEqual({ expenseId: "svc_svc_record_1", created: true });
    expect(ledger.expenses.size).toBe(1);
    expect(ledger.links).toHaveLength(1);
  });

  it("recovers after a failure between expense creation and the link", async () => {
    const ledger = fakeLedger({ failLink: 1 });

    await expect(recordServiceCost(ledger.ports, input)).rejects.toThrow("link write failed");
    // The money exists, but the service record does not reference it yet.
    expect(ledger.expenses.size).toBe(1);
    expect(ledger.links).toEqual([]);

    const retry = await recordServiceCost(ledger.ports, input);
    expect(retry).toEqual({ expenseId: "svc_svc_record_1", created: false });
    expect(ledger.expenses.size).toBe(1);
    expect(ledger.links).toEqual([
      { serviceRecordId: "svc_record_1", expenseId: "svc_svc_record_1" },
    ]);
  });

  it("reuses an expense the service record already references", async () => {
    const ledger = fakeLedger();
    const result = await recordServiceCost(ledger.ports, {
      ...input,
      existingExpenseId: "legacy_expense_9",
    });

    expect(result).toEqual({ expenseId: "legacy_expense_9", created: false });
    expect(ledger.expenses.size).toBe(0);
    expect(ledger.links).toEqual([
      { serviceRecordId: "svc_record_1", expenseId: "legacy_expense_9" },
    ]);
  });

  it("is idempotent across repeated requests", async () => {
    const ledger = fakeLedger();
    const first = await recordServiceCost(ledger.ports, input);
    const second = await recordServiceCost(ledger.ports, input);
    const third = await recordServiceCost(ledger.ports, input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(third.created).toBe(false);
    expect(ledger.expenses.size).toBe(1);
    expect(new Set(ledger.links.map((l) => l.expenseId)).size).toBe(1);
  });

  it("creates one monetary entry under concurrent requests", async () => {
    const ledger = fakeLedger();
    const results = await Promise.all([
      recordServiceCost(ledger.ports, input),
      recordServiceCost(ledger.ports, input),
      recordServiceCost(ledger.ports, input),
    ]);

    expect(ledger.expenses.size).toBe(1);
    expect(results.every((r) => r.expenseId === "svc_svc_record_1")).toBe(true);
    expect(results.filter((r) => r.created).length).toBe(1);
  });
});
