import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createFuelEntry: vi.fn(),
  recordReading: vi.fn(),
  createExpense: vi.fn(),
  writeAuditEvent: vi.fn(),
  getVehicleById: vi.fn(),
  listFuelEntries: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  assertCsrfAndOrigin: vi.fn(async () => {}),
  requireAuthContext: vi.fn(async () => ({ user: { id: "user_1" }, isPrivileged: false })),
  requirePermission: vi.fn(),
}));

vi.mock("@/lib/repos/fuel", () => ({
  createFuelEntry: mocks.createFuelEntry,
  listFuelEntries: mocks.listFuelEntries,
}));

vi.mock("@/lib/repos/odometers", () => ({ recordReading: mocks.recordReading }));

vi.mock("@/lib/repos/expenses", () => ({ createExpense: mocks.createExpense }));

vi.mock("@/lib/repos/audit", () => ({
  AUDIT_EVENTS: { FUEL_RECORDED: "fuel.recorded" },
  writeAuditEvent: mocks.writeAuditEvent,
}));

vi.mock("@/lib/repos/vehicles", () => ({ getVehicleById: mocks.getVehicleById }));

import { POST } from "@/app/api/v1/fuel/route";

const baseBody = {
  vehicleId: "veh_1",
  transactedOn: "2026-10-21",
  litres: 40,
  unitPrice: 12.5,
  totalMinor: 50000,
  fullTank: true,
};

function post(body: Record<string, unknown>) {
  return POST({ json: async () => body } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getVehicleById.mockResolvedValue({ id: "veh_1" });
  mocks.createExpense.mockResolvedValue({ id: "exp_1" });
  mocks.recordReading.mockResolvedValue({ reading: { id: "read_1" } });
  mocks.createFuelEntry.mockImplementation(async (input: Record<string, unknown>) => ({
    id: "fuel_1",
    ...input,
    createdAt: new Date(),
  }));
});

describe("POST /api/v1/fuel — optional odometer", () => {
  it("records the cost and litres without writing a ledger reading when no odometer is given", async () => {
    const response = await post(baseBody);
    expect(response.status).toBe(201);

    expect(mocks.recordReading).not.toHaveBeenCalled();
    expect(mocks.createExpense).toHaveBeenCalledTimes(1);
    const entry = mocks.createFuelEntry.mock.calls[0]![0] as Record<string, unknown>;
    expect(entry).not.toHaveProperty("odometerKm");
    expect(entry).not.toHaveProperty("odometerReadingId");
  });

  it("treats a blank string as absent rather than as zero", async () => {
    const response = await post({ ...baseBody, odometerKm: "" });
    expect(response.status).toBe(201);
    expect(mocks.recordReading).not.toHaveBeenCalled();
    expect(mocks.createFuelEntry.mock.calls[0]![0]).not.toHaveProperty("odometerKm");
  });

  it("writes the ledger reading and links it when an odometer is supplied", async () => {
    const response = await post({ ...baseBody, odometerKm: 128450 });
    expect(response.status).toBe(201);

    expect(mocks.recordReading).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleId: "veh_1", km: 128450, source: "FUEL_PURCHASE" }),
    );
    const entry = mocks.createFuelEntry.mock.calls[0]![0] as Record<string, unknown>;
    expect(entry.odometerKm).toBe(128450);
    expect(entry.odometerReadingId).toBe("read_1");
  });

  it("rejects a supplied invalid odometer before creating money or a reading", async () => {
    const response = await post({ ...baseBody, odometerKm: -1 });
    expect(response.status).toBe(400);

    expect(mocks.recordReading).not.toHaveBeenCalled();
    expect(mocks.createExpense).not.toHaveBeenCalled();
    expect(mocks.createFuelEntry).not.toHaveBeenCalled();
  });
});
