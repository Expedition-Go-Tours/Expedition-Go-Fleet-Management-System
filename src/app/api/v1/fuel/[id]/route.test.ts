import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  correctFuelEntry: vi.fn(),
  writeAuditEvent: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  assertCsrfAndOrigin: vi.fn(async () => {}),
  requireAuthContext: vi.fn(async () => ({ user: { id: "user_1" }, isPrivileged: true })),
  requirePermission: vi.fn(),
}));

vi.mock("@/lib/repos/fuel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repos/fuel")>();
  return { ...actual, correctFuelEntry: mocks.correctFuelEntry };
});

vi.mock("@/lib/repos/audit", () => ({
  AUDIT_EVENTS: { FUEL_CORRECTED: "fuel.corrected" },
  writeAuditEvent: mocks.writeAuditEvent,
}));

import { PATCH } from "@/app/api/v1/fuel/[id]/route";
import { FuelEntryError } from "@/lib/repos/fuel";

const before = {
  id: "fuel_1",
  vehicleId: "veh_1",
  transactedOn: "2026-10-20",
  odometerKm: 128450,
  fuelType: "PETROL",
  totalMinor: 40000,
  currency: "GHS",
  station: "Goil",
  paidTo: "Ama",
  fullTank: true,
  expenseId: "exp_1",
  recordedBy: "user_1",
  createdAt: new Date("2026-10-20T12:00:00Z"),
};

const validBody = {
  transactedOn: "2026-10-21",
  totalMinor: 50000,
  fuelType: "PETROL",
  station: "  Goil, Accra Central  ",
  paidTo: "  Kofi Mensah  ",
  fullTank: true,
};

function patch(body: Record<string, unknown>, id = "fuel_1") {
  return PATCH({ json: async () => body } as never, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.correctFuelEntry.mockImplementation(async (input: Record<string, unknown>) => ({
    before,
    after: { ...before, ...input },
  }));
});

describe("PATCH /api/v1/fuel/[id] — correct a recorded purchase", () => {
  it("applies the corrected fields and audits before/after", async () => {
    const response = await patch(validBody);
    expect(response.status).toBe(200);

    expect(mocks.correctFuelEntry).toHaveBeenCalledWith({
      id: "fuel_1",
      transactedOn: "2026-10-21",
      totalMinor: 50000,
      fuelType: "PETROL",
      station: "Goil, Accra Central",
      paidTo: "Kofi Mensah",
      fullTank: true,
    });
    expect(mocks.writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "fuel.corrected",
        entityType: "fuelEntry",
        entityId: "fuel_1",
        before: expect.objectContaining({ totalMinor: 40000, paidTo: "Ama" }),
        after: expect.objectContaining({ totalMinor: 50000, paidTo: "Kofi Mensah" }),
      }),
    );
  });

  it("clears the station and payee when the operator empties them", async () => {
    await patch({ ...validBody, station: "", paidTo: "" });
    expect(mocks.correctFuelEntry).toHaveBeenCalledWith(
      expect.objectContaining({ station: undefined, paidTo: undefined }),
    );
  });

  it("rejects an invalid date, amount or fuel type without writing", async () => {
    const badDate = await patch({ ...validBody, transactedOn: "21/10/2026" });
    expect(badDate.status).toBe(400);

    const badAmount = await patch({ ...validBody, totalMinor: 0 });
    expect(badAmount.status).toBe(400);

    const badType = await patch({ ...validBody, fuelType: "LPG" });
    expect(badType.status).toBe(400);

    const longPayee = await patch({ ...validBody, paidTo: "x".repeat(201) });
    expect(longPayee.status).toBe(400);

    expect(mocks.correctFuelEntry).not.toHaveBeenCalled();
  });

  it("maps a missing entry to 404", async () => {
    mocks.correctFuelEntry.mockRejectedValueOnce(
      new FuelEntryError("FUEL_ENTRY_NOT_FOUND", "Fuel entry not found"),
    );
    const response = await patch(validBody);
    expect(response.status).toBe(404);
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled();
  });
});
