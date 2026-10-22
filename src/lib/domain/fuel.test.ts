import { describe, expect, it } from "vitest";

import {
  buildFuelCreatePayload,
  computeConsumption,
  isValidFuelEntry,
  type FuelPurchaseFormValues,
} from "@/lib/domain/fuel";

const validForm: FuelPurchaseFormValues = {
  vehicleId: "veh_1",
  transactedOn: "2026-10-21",
  odometerKm: "128450",
  litres: "40",
  unitPrice: "12.5",
  fuelType: "PETROL",
  station: "  Goil, Accra Central  ",
  fullTank: true,
};

function build(overrides: Partial<FuelPurchaseFormValues>) {
  return buildFuelCreatePayload({ ...validForm, ...overrides });
}

describe("buildFuelCreatePayload — form to POST /api/v1/fuel body", () => {
  it("builds a complete payload with the cost in integer pesewas", () => {
    const result = build({});
    expect(result).toEqual({
      ok: true,
      payload: {
        vehicleId: "veh_1",
        transactedOn: "2026-10-21",
        odometerKm: 128450,
        litres: 40,
        unitPrice: 12.5,
        totalMinor: 50000,
        fuelType: "PETROL",
        station: "Goil, Accra Central",
        fullTank: true,
      },
    });
  });

  it("computes the total the server will store, without float drift", () => {
    // 0.29 * 100 = 28.999999999999996 in IEEE-754; the integer path must be exact.
    const result = build({ litres: "10", unitPrice: "0.29" });
    expect(result.ok && result.payload.totalMinor).toBe(290);
    expect(result.ok && result.payload.unitPrice).toBe(0.29);
  });

  it("omits the station when it is blank rather than sending empty text", () => {
    const result = build({ station: "   " });
    expect(result.ok && result.payload.station).toBeUndefined();
    expect(result.ok && "station" in result.payload).toBe(false);
  });

  it("defaults a blank fuel type to PETROL and rejects an unsupported one", () => {
    const defaulted = build({ fuelType: "  " });
    expect(defaulted.ok && defaulted.payload.fuelType).toBe("PETROL");
    expect(build({ fuelType: "LPG" })).toEqual({ ok: false, message: "Unsupported fuel type" });
  });

  it("preserves fullTank exactly as typed", () => {
    const partial = build({ fullTank: false });
    expect(partial.ok && partial.payload.fullTank).toBe(false);
  });

  it("names the first problem instead of submitting a bad body", () => {
    expect(build({ vehicleId: "  " })).toEqual({
      ok: false,
      message: "Choose the vehicle that was filled up",
    });
    expect(build({ transactedOn: "21/10/2026" })).toEqual({
      ok: false,
      message: "transactedOn must be YYYY-MM-DD",
    });
    expect(build({ odometerKm: "-5" })).toEqual({
      ok: false,
      message: "odometerKm is required (non-negative integer)",
    });
    expect(build({ odometerKm: "" })).toEqual({
      ok: false,
      message: "odometerKm is required (non-negative integer)",
    });
    expect(build({ litres: "0" })).toEqual({
      ok: false,
      message: "litres must be a positive number",
    });
    expect(build({ unitPrice: "abc" })).toEqual({
      ok: false,
      message: "unitPrice must be a positive amount",
    });
    expect(build({ unitPrice: "" })).toEqual({
      ok: false,
      message: "unitPrice must be a positive amount",
    });
  });
});

describe("isValidFuelEntry", () => {
  it("accepts a positive volume and a positive integer pesewa total", () => {
    expect(isValidFuelEntry({ litres: 42.5, totalMinor: 53125 })).toEqual({ ok: true });
  });

  it("rejects bad volumes and non-integer or non-positive totals", () => {
    expect(isValidFuelEntry({ litres: 0, totalMinor: 100 }).ok).toBe(false);
    expect(isValidFuelEntry({ litres: Number.NaN, totalMinor: 100 }).ok).toBe(false);
    expect(isValidFuelEntry({ litres: 10, totalMinor: 0 }).ok).toBe(false);
    expect(isValidFuelEntry({ litres: 10, totalMinor: 10.5 }).ok).toBe(false);
    expect(isValidFuelEntry({ litres: 10, totalMinor: "100" }).ok).toBe(false);
  });
});

describe("computeConsumption — full-tank sequences only", () => {
  const tank = (odometerKm: number, litres: number, fullTank = true) => ({
    odometerKm,
    litres,
    fullTank,
  });

  it("measures km/l between two consecutive full-tank fill-ups", () => {
    expect(computeConsumption(tank(1000, 40), tank(1400, 50))).toEqual({ kmPerLitre: 8 });
  });

  it("refuses a sequence that is not both full-tank", () => {
    const result = computeConsumption(tank(1000, 40, false), tank(1400, 50));
    expect(result.kmPerLitre).toBeNull();
    expect(result.reason).toBe("Both fill-ups must be full-tank for a defensible figure");
  });

  it("refuses contradictory or missing odometer and volume", () => {
    expect(computeConsumption(tank(1400, 40), tank(1000, 50)).kmPerLitre).toBeNull();
    expect(computeConsumption(tank(1000, 40), tank(1000, 50)).kmPerLitre).toBeNull();
    expect(computeConsumption(tank(1000, 40), tank(1400, 0)).kmPerLitre).toBeNull();
  });
});
