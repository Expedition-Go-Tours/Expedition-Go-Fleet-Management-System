import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  correctServiceRecord: vi.fn(),
  writeAuditEvent: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  assertCsrfAndOrigin: vi.fn(async () => {}),
  requireAuthContext: vi.fn(async () => ({ user: { id: "user_1" }, isPrivileged: true })),
  requirePermission: vi.fn(),
}));

vi.mock("@/lib/domain/service-correction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/domain/service-correction")>();
  return { ...actual, correctServiceRecord: mocks.correctServiceRecord };
});

vi.mock("@/lib/repos/audit", () => ({
  AUDIT_EVENTS: { SERVICE_CORRECTED: "service.corrected" },
  writeAuditEvent: mocks.writeAuditEvent,
}));

import { PATCH } from "@/app/api/v1/service-records/[id]/route";
import { ServiceCorrectionError } from "@/lib/domain/service-correction";

const before = {
  id: "svc_1",
  vehicleId: "veh_1",
  scheduleId: "sched_1",
  taskName: "Oil & filter change",
  completedAt: new Date("2026-10-20T00:00:00.000Z"),
  odometerKm: 128450,
  workPerformed: "Changed engine oil and filter",
  providerName: "Kingdom Motors",
  paidTo: "Ama",
  expenseIds: ["exp_1"],
  repairCostMinor: 40000,
  labourCostMinor: 20000,
  costItems: [{ name: "Oil filter", amountMinor: 20000 }],
  resolvedIssueIds: [],
  recordedByUserId: "user_1",
  createdAt: new Date("2026-10-20T12:00:00Z"),
};

const validBody = {
  completedAt: "2026-10-21",
  taskName: "Oil & filter change",
  workPerformed: "  Changed engine oil, filter and checked brakes  ",
  providerName: "  Kingdom Motors  ",
  technicianName: "  Ama Owusu  ",
  paidTo: "  Kofi Mensah  ",
  notes: "  Replaced under warranty  ",
  labourMinor: 30000,
  items: [{ name: "Oil filter", amountMinor: 8000 }],
};

function patch(body: Record<string, unknown>, id = "svc_1") {
  return PATCH({ json: async () => body } as never, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.correctServiceRecord.mockImplementation(async (input: Record<string, unknown>) => ({
    before,
    after: { ...before, ...input },
    expenseId: "exp_1",
    expenseCreated: false,
  }));
});

describe("PATCH /api/v1/service-records/[id] — correct a completed service", () => {
  it("applies the corrected fields and audits before/after", async () => {
    const response = await patch(validBody);
    expect(response.status).toBe(200);

    expect(mocks.correctServiceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceRecordId: "svc_1",
        completedAt: new Date("2026-10-21"),
        taskName: "Oil & filter change",
        workPerformed: "Changed engine oil, filter and checked brakes",
        providerName: "Kingdom Motors",
        technicianName: "Ama Owusu",
        paidTo: "Kofi Mensah",
        notes: "Replaced under warranty",
        repairCost: {
          amountMinor: 38000,
          currency: "GHS",
          labourMinor: 30000,
          items: [{ name: "Oil filter", amountMinor: 8000 }],
        },
        actorId: "user_1",
      }),
    );
    expect(mocks.writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "service.corrected",
        entityType: "serviceRecord",
        entityId: "svc_1",
        before: expect.objectContaining({ workPerformed: "Changed engine oil and filter" }),
        after: expect.objectContaining({
          workPerformed: "Changed engine oil, filter and checked brakes",
        }),
      }),
    );
  });

  it("accepts a legacy flat cost and clears the payee when emptied", async () => {
    await patch({ completedAt: "2026-10-21", workPerformed: "Repair", costMinor: 50000, paidTo: "" });
    expect(mocks.correctServiceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        paidTo: undefined,
        repairCost: { amountMinor: 50000, currency: "GHS" },
      }),
    );
  });

  it("falls back to the work description when the label is blank", async () => {
    await patch({ completedAt: "2026-10-21", workPerformed: "  Replace brake pads  " });
    expect(mocks.correctServiceRecord).toHaveBeenCalledWith(
      expect.objectContaining({ taskName: "Replace brake pads" }),
    );
  });

  it("rejects missing or invalid fields without writing", async () => {
    expect((await patch({ ...validBody, completedAt: "21/10/2026" })).status).toBe(400);
    expect((await patch({ ...validBody, completedAt: "2099-01-01" })).status).toBe(400);
    expect((await patch({ ...validBody, workPerformed: "  " })).status).toBe(400);
    expect((await patch({ ...validBody, paidTo: "x".repeat(201) })).status).toBe(400);
    expect((await patch({ ...validBody, labourMinor: -1, items: [] })).status).toBe(400);
    expect(mocks.correctServiceRecord).not.toHaveBeenCalled();
  });

  it("maps a missing record to 404 and a cleared existing cost to 400", async () => {
    mocks.correctServiceRecord.mockRejectedValueOnce(
      new ServiceCorrectionError("SERVICE_NOT_FOUND", "Service record not found"),
    );
    expect((await patch(validBody)).status).toBe(404);

    mocks.correctServiceRecord.mockRejectedValueOnce(
      new ServiceCorrectionError("COST_REQUIRED", "This service already has a recorded cost."),
    );
    expect((await patch(validBody)).status).toBe(400);
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled();
  });
});
