import { describe, expect, it } from "vitest";

import {
  detectHistoricalConflict,
  projectionFromLedger,
  validateCorrection,
  validateReading,
  type OdometerReading,
} from "@/lib/domain/odometer";

function reading(km: number, status: "ACCEPTED" | "SUPERSEDED" | "FLAGGED"): OdometerReading {
  return {
    id: `r-${km}-${status}`,
    vehicleId: "veh1",
    km,
    effectiveAt: new Date(),
    createdAt: new Date(),
    recordedByUserId: "u1",
    source: "TRIP_END",
    status,
  };
}

describe("odometer ledger — mandated mileage guarantees", () => {
  it("live readings may never decrease (no silent decrease)", () => {
    const result = validateReading(79000, "TRIP_END", 80000);
    expect(result).toMatchObject({ ok: false, code: "DECREASE_REJECTED" });
    const message = result.ok ? "" : result.message;
    expect(message).toContain("correction workflow");
  });

  it("equal or higher readings are accepted", () => {
    expect(validateReading(80000, "TRIP_END", 80000).ok).toBe(true);
    expect(validateReading(81250, "FUEL_PURCHASE", 80000).ok).toBe(true);
  });

  it("non-integer, negative, and absurd values are rejected", () => {
    expect(validateReading(12.5, "MANUAL_ENTRY", 80000)).toMatchObject({
      ok: false,
      code: "INVALID_KM",
    });
    expect(validateReading(-1, "MANUAL_ENTRY", 80000).ok).toBe(false);
    expect(validateReading(9_000_000, "MANUAL_ENTRY", 80000).ok).toBe(false);
    expect(validateReading("80000" as unknown, "MANUAL_ENTRY", 80000).ok).toBe(false);
  });

  it("a brand-new vehicle (zero projection) accepts its first reading", () => {
    expect(validateReading(1500, "TRIP_START", 0).ok).toBe(true);
  });

  it("corrections may go below today's projection (that is the point)", () => {
    expect(validateCorrection(75000).ok).toBe(true);
    expect(validateCorrection(-5)).toMatchObject({ ok: false, code: "INVALID_KM" });
  });

  it("projection is the max accepted reading — superseded/flagged never count", () => {
    const ledger = [
      reading(80000, "ACCEPTED"),
      reading(79000, "ACCEPTED"),
      reading(82000, "SUPERSEDED"),
      reading(81000, "FLAGGED"),
    ];
    expect(projectionFromLedger(ledger)).toBe(80000);
  });

  it("correction supersession leaves a consistent projection", () => {
    const afterCorrection = [
      reading(80000, "SUPERSEDED"), // original, superseded
      reading(79500, "ACCEPTED"), // replacement
      reading(79000, "ACCEPTED"), // older history
    ];
    expect(projectionFromLedger(afterCorrection)).toBe(79500);
  });

  it("historical imports conflict when they break neighbouring monotonicity", () => {
    expect(detectHistoricalConflict(78000, 79000, null)).toContain("below");
    expect(detectHistoricalConflict(82000, null, 81000)).toContain("exceeds");
    expect(detectHistoricalConflict(80500, 79000, 81000)).toBeNull();
    expect(detectHistoricalConflict(80500, null, null)).toBeNull();
  });
});
