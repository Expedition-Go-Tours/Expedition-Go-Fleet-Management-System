import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteExpenseRecord: vi.fn(),
  writeAuditEvent: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  assertCsrfAndOrigin: vi.fn(async () => {}),
  requireAuthContext: vi.fn(async () => ({ user: { id: "admin_1" }, isPrivileged: true })),
  requirePermission: vi.fn(),
}));

vi.mock("@/lib/repos/expenses", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repos/expenses")>();
  return { ...actual, deleteExpenseRecord: mocks.deleteExpenseRecord };
});

vi.mock("@/lib/repos/audit", () => ({
  AUDIT_EVENTS: { EXPENSE_DELETED: "expense.deleted" },
  writeAuditEvent: mocks.writeAuditEvent,
}));

import { DELETE } from "@/app/api/v1/expenses/[id]/route";
import { DeletionError } from "@/lib/domain/deletion";

const before = {
  id: "exp_1",
  vehicleId: "veh_1",
  category: "MAINTENANCE",
  amountMinor: 40000,
  currency: "GHS",
  description: "Oil filter",
  supplierName: "Kingdom Motors",
  paidTo: "Ama",
  incurredOn: new Date("2026-10-20T00:00:00.000Z"),
  status: "PENDING",
  createdBy: "user_1",
  createdAt: new Date("2026-10-20T12:00:00Z"),
  updatedAt: new Date("2026-10-20T12:00:00Z"),
};

function del(body: Record<string, unknown>, id = "exp_1") {
  return DELETE({ json: async () => body } as never, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deleteExpenseRecord.mockResolvedValue({
    before,
    unlinkedFuelEntryId: undefined,
    unlinkedServiceRecordId: "svc_1",
    clearedServiceCost: true,
  });
});

describe("DELETE /api/v1/expenses/[id] — permanently delete an expense", () => {
  it("deletes the expense, reports cleanup and audits the reason", async () => {
    const response = await del({ reason: "  Duplicate of another entry  " });
    expect(response.status).toBe(200);

    expect(mocks.deleteExpenseRecord).toHaveBeenCalledWith(
      "exp_1",
      expect.objectContaining({
        eventType: "expense.deleted",
        entityType: "expense",
        entityId: "exp_1",
        actorId: "admin_1",
        reason: "Duplicate of another entry",
        requestId: expect.any(String),
      }),
    );
    // The repository writes the audit event in the delete transaction.
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled();

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      deleted: true,
      unlinkedServiceRecordId: "svc_1",
      clearedServiceCost: true,
    });
  });

  it("requires a written reason before deleting", async () => {
    expect((await del({})).status).toBe(400);
    expect((await del({ reason: "  " })).status).toBe(400);
    expect((await del({ reason: "x".repeat(501) })).status).toBe(400);
    expect(mocks.deleteExpenseRecord).not.toHaveBeenCalled();
  });

  it("maps a missing expense to 404", async () => {
    mocks.deleteExpenseRecord.mockRejectedValueOnce(
      new DeletionError("EXPENSE_NOT_FOUND", "Expense not found"),
    );
    expect((await del({ reason: "Mistaken entry" })).status).toBe(404);
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled();
  });
});
