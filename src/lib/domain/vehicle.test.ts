import { describe, expect, it } from "vitest";

import { OWNERSHIP_CLASSES, parseRentedVehicleSpec, VEHICLE_TYPES } from "@/lib/domain/vehicle";

describe("OWNERSHIP_CLASSES", () => {
  it("records a hired-in bus honestly rather than as a company vehicle", () => {
    expect(OWNERSHIP_CLASSES).toEqual(["COMPANY_OWNED", "RENTED"]);
  });
});

describe("parseRentedVehicleSpec — hired-in bus details", () => {
  const thisYear = new Date().getFullYear();

  it("accepts a complete spec and trims what the operator typed", () => {
    const result = parseRentedVehicleSpec({
      regNumber: "  GR 1234-24  ",
      make: "  Yutong ",
      model: " ZK6126",
      year: 2019,
      type: "BUS",
    });
    expect(result).toEqual({
      ok: true,
      spec: { regNumber: "GR 1234-24", make: "Yutong", model: "ZK6126", year: 2019, type: "BUS" },
    });
  });

  it("defaults the vehicle type to BUS", () => {
    const result = parseRentedVehicleSpec({
      regNumber: "GR1234-24",
      make: "Yutong",
      model: "ZK6126",
      year: 2019,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec.type).toBe("BUS");
  });

  it("requires the plate", () => {
    for (const regNumber of ["", "   "]) {
      const result = parseRentedVehicleSpec({
        regNumber,
        make: "Yutong",
        model: "ZK6126",
        year: 2019,
      });
      expect(result).toEqual({ ok: false, message: "Registration number is required" });
    }
  });

  it("requires make and model — a placeholder record reads as real data", () => {
    for (const [make, model] of [
      ["", "ZK6126"],
      ["Yutong", ""],
    ]) {
      const result = parseRentedVehicleSpec({ regNumber: "GR1234-24", make, model, year: 2019 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/required/);
    }
  });

  it("requires a plausible year", () => {
    const base = { regNumber: "GR1234-24", make: "Yutong", model: "ZK6126" };

    expect(parseRentedVehicleSpec({ ...base, year: 1979 }).ok).toBe(false);
    expect(parseRentedVehicleSpec({ ...base, year: thisYear + 2 }).ok).toBe(false);
    expect(parseRentedVehicleSpec({ ...base, year: 2019.5 }).ok).toBe(false);
    expect(parseRentedVehicleSpec({ ...base, year: thisYear + 1 }).ok).toBe(true);
    // An <input type="number"> submits a string; coercion is intended, so a
    // well-formed year arriving as text must still be accepted.
    expect(parseRentedVehicleSpec({ ...base, year: "2019" }).ok).toBe(true);
  });

  it("rejects an unknown vehicle type", () => {
    const result = parseRentedVehicleSpec({
      regNumber: "GR1234-24",
      make: "Yutong",
      model: "ZK6126",
      year: 2019,
      type: "HOVERCRAFT",
    });
    expect(result).toEqual({
      ok: false,
      message: `Type must be one of: ${VEHICLE_TYPES.join(", ")}`,
    });
  });

  it("caps the text fields so a paste cannot overflow the record", () => {
    const base = { regNumber: "GR1234-24", make: "Yutong", model: "ZK6126", year: 2019 };

    expect(parseRentedVehicleSpec({ ...base, regNumber: "X".repeat(21) }).ok).toBe(false);
    expect(parseRentedVehicleSpec({ ...base, make: "X".repeat(101) }).ok).toBe(false);
    expect(parseRentedVehicleSpec({ ...base, model: "X".repeat(101) }).ok).toBe(false);
  });

  it("rejects a missing or non-object payload rather than inventing a bus", () => {
    expect(parseRentedVehicleSpec(undefined).ok).toBe(false);
    expect(parseRentedVehicleSpec(null).ok).toBe(false);
    expect(parseRentedVehicleSpec("GR1234-24").ok).toBe(false);
  });
});
