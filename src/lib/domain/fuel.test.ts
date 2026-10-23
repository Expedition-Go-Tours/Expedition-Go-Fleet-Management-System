import { describe, expect, it } from "vitest";

import {
  buildFuelCreatePayload,
  computeConsumption,
  consumptionByEntry,
  isValidFuelEntry,
  latestConsumption,
  parseOdometerKm,
  type FuelPurchaseFormValues,
} from "@/lib/domain/fuel";

const validForm: FuelPurchaseFormValues = {
  vehicleId: "veh_1",
  transactedOn: "2026-10-21",
  odometerKm: "128450",
  amount: "500.00",
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
        totalMinor: 50000,
        fuelType: "PETROL",
        station: "Goil, Accra Central",
        fullTank: true,
      },
    });
  });

  it("stores the amount the operator typed, in exact integer pesewas", () => {
    // 500.29 * 100 = 50028.999999999993 in IEEE-754; the integer path must be exact.
    const result = build({ amount: "500.29" });
    expect(result.ok && result.payload.totalMinor).toBe(50029);
  });

  it("does not send litres or a unit price", () => {
    const result = build({});
    expect(result.ok && "litres" in result.payload).toBe(false);
    expect(result.ok && "unitPrice" in result.payload).toBe(false);
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

  it("omits the odometer when the office cannot read it, instead of inventing 0", () => {
    const result = build({ odometerKm: "" });
    expect(result.ok).toBe(true);
    expect(result.ok && "odometerKm" in result.payload).toBe(false);

    const whitespace = build({ odometerKm: "   " });
    expect(whitespace.ok && "odometerKm" in whitespace.payload).toBe(false);
  });

  it("rejects a supplied odometer that is not a non-negative integer", () => {
    for (const odometerKm of ["-5", "abc", "12.5"]) {
      expect(build({ odometerKm })).toEqual({
        ok: false,
        message: "odometerKm must be a non-negative integer when provided",
      });
    }
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
    expect(build({ amount: "0" })).toEqual({
      ok: false,
      message: "amount must be a positive amount",
    });
    for (const amount of ["abc", "", "12.345", "-5"]) {
      expect(build({ amount })).toEqual({
        ok: false,
        message: "amount must be a positive amount",
      });
    }
  });
});

describe("isValidFuelEntry", () => {
  it("accepts an amount without a volume, and a volume when supplied", () => {
    expect(isValidFuelEntry({ totalMinor: 53125 })).toEqual({ ok: true });
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

describe("parseOdometerKm — absence is not zero", () => {
  it("keeps an absent reading absent", () => {
    for (const value of [undefined, null, "", "   "]) {
      expect(parseOdometerKm(value)).toEqual({ ok: true });
    }
  });

  it("accepts a whole non-negative reading", () => {
    expect(parseOdometerKm("128450")).toEqual({ ok: true, odometerKm: 128450 });
    expect(parseOdometerKm(0)).toEqual({ ok: true, odometerKm: 0 });
  });

  it("rejects a supplied value that is not a non-negative whole number", () => {
    for (const value of [-1, 12.5, "abc", "12.5", Number.NaN, true, {}]) {
      expect(parseOdometerKm(value)).toEqual({
        ok: false,
        message: "odometerKm must be a non-negative integer when provided",
      });
    }
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

  it("refuses to measure when either fill-up has no reading", () => {
    const firstMissing = computeConsumption(
      { litres: 40, fullTank: true },
      { odometerKm: 1400, litres: 50, fullTank: true },
    );
    expect(firstMissing.kmPerLitre).toBeNull();
    expect(firstMissing.reason).toBe(
      "Both fill-ups need an odometer reading for a defensible figure",
    );

    const secondMissing = computeConsumption(
      { odometerKm: 1000, litres: 40, fullTank: true },
      { litres: 50, fullTank: true },
    );
    expect(secondMissing.kmPerLitre).toBeNull();
  });

  it("refuses to measure when either fill-up has no volume", () => {
    const firstMissing = computeConsumption(
      { odometerKm: 1000, fullTank: true },
      { odometerKm: 1400, litres: 50, fullTank: true },
    );
    expect(firstMissing.kmPerLitre).toBeNull();
    expect(firstMissing.reason).toBe(
      "Both fill-ups need a recorded volume for a defensible figure",
    );

    const secondMissing = computeConsumption(
      { odometerKm: 1000, litres: 40, fullTank: true },
      { odometerKm: 1400, fullTank: true },
    );
    expect(secondMissing.kmPerLitre).toBeNull();
  });
});

describe("consumptionByEntry — a missing reading breaks the chain", () => {
  const fill = (
    id: string,
    transactedOn: string,
    odometerKm: number | undefined,
    litres: number | undefined,
    overrides: Partial<{ vehicleId: string; fullTank: boolean }> = {},
  ) => ({
    id,
    vehicleId: overrides.vehicleId ?? "veh_1",
    transactedOn,
    odometerKm,
    litres,
    fullTank: overrides.fullTank ?? true,
  });

  it("marks the fill-up that closes a measured segment", () => {
    const measured = consumptionByEntry([
      fill("a", "2026-10-01", 1000, 40),
      fill("b", "2026-10-08", 1400, 50),
    ]);
    expect(measured.get("b")).toBe(8);
    expect(measured.has("a")).toBe(false);
  });

  it("does not pair across a full-tank fill-up with no reading", () => {
    const measured = consumptionByEntry([
      fill("a", "2026-10-01", 1000, 40),
      fill("b", "2026-10-05", undefined, 30),
      fill("c", "2026-10-12", 1800, 50),
    ]);
    // Distance a→c is real, but b's litres are unaccounted for: c must not
    // inherit a figure that would overstate efficiency.
    expect(measured.has("c")).toBe(false);
    expect(measured.size).toBe(0);
  });

  it("starts measuring again only after the gap", () => {
    const measured = consumptionByEntry([
      fill("a", "2026-10-01", 1000, 40),
      fill("b", "2026-10-05", undefined, 30),
      fill("c", "2026-10-12", 1800, 50),
      fill("d", "2026-10-19", 2300, 50),
    ]);
    expect(measured.has("c")).toBe(false);
    expect(measured.get("d")).toBe(10);
  });

  it("breaks the chain at an amount-only fill-up with no litres", () => {
    const measured = consumptionByEntry([
      fill("a", "2026-10-01", 1000, 40),
      fill("b", "2026-10-05", 1400, undefined),
      fill("c", "2026-10-12", 1800, 50),
    ]);
    expect(measured.has("b")).toBe(false);
    expect(measured.has("c")).toBe(false);
    expect(measured.size).toBe(0);
  });

  it("breaks the chain at an intervening partial fill-up", () => {
    const measured = consumptionByEntry([
      fill("a", "2026-10-01", 1000, 40),
      fill("b", "2026-10-05", 1200, 20, { fullTank: false }),
      fill("c", "2026-10-12", 1800, 50),
    ]);
    expect(measured.size).toBe(0);
  });

  it("never pairs fill-ups from different vehicles", () => {
    const measured = consumptionByEntry([
      fill("a", "2026-10-01", 1000, 40, { vehicleId: "veh_1" }),
      fill("b", "2026-10-02", 1500, 50, { vehicleId: "veh_2" }),
    ]);
    expect(measured.size).toBe(0);
  });

  it("follows purchase order, not array order or odometer order", () => {
    const measured = consumptionByEntry([
      fill("later", "2026-10-12", 1800, 50),
      fill("earlier", "2026-10-01", 1000, 40),
    ]);
    expect(measured.get("later")).toBe(16);
  });

  it("latestConsumption reports the most recent measured segment only", () => {
    const entries = [
      fill("a", "2026-10-01", 1000, 40),
      fill("b", "2026-10-08", 1400, 50),
      fill("c", "2026-10-10", 1600, 20, { fullTank: false }),
      fill("d", "2026-10-15", 2000, 50),
    ];
    expect(latestConsumption(entries)).toEqual({ kmPerLitre: 8 });
    expect(latestConsumption(entries, "veh_2")).toEqual({
      kmPerLitre: null,
      reason: "Not enough consecutive full-tank fill-ups with odometer readings",
    });
  });
});
