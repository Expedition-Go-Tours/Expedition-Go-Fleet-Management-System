import { describe, expect, it } from "vitest";

import {
  buildServiceExpenseRecord,
  recordServiceCost,
  resolveServiceCostInput,
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
  paidTo: "  Kofi Mensah  ",
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
      paidTo: "Kofi Mensah",
      createdBy: "user_1",
    });
  });

  it("omits a blank payee rather than storing empty text", () => {
    expect(buildServiceExpenseRecord({ ...input, paidTo: "   " }).paidTo).toBeUndefined();
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

describe("resolveServiceCostInput — workmanship + parts total", () => {
  it("returns null when nothing was entered", () => {
    expect(resolveServiceCostInput({})).toBeNull();
    expect(resolveServiceCostInput({ costMinor: "", labourMinor: "", items: [] })).toBeNull();
  });

  it("keeps the legacy single total when no breakdown is supplied", () => {
    expect(resolveServiceCostInput({ costMinor: 45000 })).toEqual({
      amountMinor: 45000,
      currency: "GHS",
    });
  });

  it("sums workmanship and multiple parts into the authoritative total", () => {
    const resolved = resolveServiceCostInput({
      labourMinor: 20000,
      items: [
        { name: "  Oil filter ", amountMinor: 8000 },
        { name: "Engine oil", amountMinor: 17000 },
      ],
    });

    expect(resolved).toEqual({
      amountMinor: 45000,
      currency: "GHS",
      labourMinor: 20000,
      items: [
        { name: "Oil filter", amountMinor: 8000 },
        { name: "Engine oil", amountMinor: 17000 },
      ],
    });
  });

  it("supports parts-only and labour-only invoices", () => {
    expect(resolveServiceCostInput({ items: [{ name: "Wiper", amountMinor: 5000 }] })).toEqual({
      amountMinor: 5000,
      currency: "GHS",
      labourMinor: 0,
      items: [{ name: "Wiper", amountMinor: 5000 }],
    });
    expect(resolveServiceCostInput({ labourMinor: 12000, items: [] })).toEqual({
      amountMinor: 12000,
      currency: "GHS",
      labourMinor: 12000,
      items: [],
    });
  });

  it("accepts a declared total only when it matches the breakdown", () => {
    expect(
      resolveServiceCostInput({
        labourMinor: 10000,
        items: [{ name: "Filter", amountMinor: 5000 }],
        costMinor: 15000,
      })?.amountMinor,
    ).toBe(15000);

    expect(() =>
      resolveServiceCostInput({
        labourMinor: 10000,
        items: [{ name: "Filter", amountMinor: 5000 }],
        costMinor: 14000,
      }),
    ).toThrowError(/match/i);
  });

  it("rejects malformed costs instead of silently dropping them", () => {
    const codeOf = (args: Parameters<typeof resolveServiceCostInput>[0]) => {
      try {
        resolveServiceCostInput(args);
        return "NO_THROW";
      } catch (err) {
        return (err as ServiceCostError).code;
      }
    };

    expect(codeOf({ labourMinor: -1, items: [] })).toBe("INVALID_AMOUNT");
    expect(codeOf({ labourMinor: 12.5, items: [] })).toBe("INVALID_AMOUNT");
    expect(codeOf({ items: [{ name: "", amountMinor: 100 }] })).toBe("INVALID_COST_ITEM");
    expect(codeOf({ items: [{ name: "Part", amountMinor: 0 }] })).toBe("INVALID_COST_ITEM");
    expect(codeOf({ items: "not-a-list" })).toBe("INVALID_COST_ITEM");
    expect(codeOf({ costMinor: 0 })).toBe("INVALID_AMOUNT");
  });
});
