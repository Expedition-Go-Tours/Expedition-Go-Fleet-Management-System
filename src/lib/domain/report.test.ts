import { describe, expect, it } from "vitest";

import {
  buildIssueIntakePayload,
  type IssueIntakeValues,
} from "@/lib/domain/report";

const drivableForm: IssueIntakeValues = {
  vehicleId: "veh_1",
  title: "Brake noise when stopping",
  description: "Grinding sound from the front left wheel at low speed.",
  drivable: true,
  severity: "MEDIUM",
  category: "BRAKES",
};

function intake(overrides: Partial<IssueIntakeValues>) {
  return buildIssueIntakePayload({ ...drivableForm, ...overrides });
}

describe("buildIssueIntakePayload — one intake for every entry point", () => {
  it("reports an undrivable vehicle as critical and immobilized", () => {
    const result = intake({ drivable: false });
    expect(result).toEqual({
      ok: true,
      payload: {
        vehicleId: "veh_1",
        title: "Brake noise when stopping",
        description: "Grinding sound from the front left wheel at low speed.",
        severity: "CRITICAL",
        safetyCritical: true,
        immobilized: true,
      },
    });
  });

  it("keeps the reporter's own severity for a drivable vehicle", () => {
    const result = intake({ severity: "LOW" });
    expect(result.ok && result.payload.severity).toBe("LOW");
    expect(result.ok && result.payload.safetyCritical).toBe(false);
    expect(result.ok && result.payload.immobilized).toBe(false);
  });

  it("still restricts the vehicle when an advanced report is marked critical", () => {
    const result = intake({ severity: "CRITICAL" });
    expect(result.ok && result.payload.safetyCritical).toBe(true);
    expect(result.ok && result.payload.immobilized).toBe(false);
  });

  it("falls back to MEDIUM for an unknown severity and drops an unknown category", () => {
    const result = intake({ severity: "URGENT", category: "SOMETHING" });
    expect(result.ok && result.payload.severity).toBe("MEDIUM");
    expect(result.ok && "category" in result.payload).toBe(false);
  });

  it("passes through a valid category and trims the free text", () => {
    const result = intake({
      vehicleId: "  veh_9  ",
      title: "  Warning light  ",
      description: "  Oil pressure light came on.  ",
      category: "WARNING_LIGHT",
    });
    expect(result.ok && result.payload).toMatchObject({
      vehicleId: "veh_9",
      title: "Warning light",
      description: "Oil pressure light came on.",
      category: "WARNING_LIGHT",
    });
  });

  it("names the first problem instead of submitting a bad body", () => {
    expect(intake({ vehicleId: "   " })).toEqual({
      ok: false,
      message: "Choose the vehicle.",
    });
    expect(intake({ title: "  " })).toEqual({
      ok: false,
      message: "A short title is required (max 200 characters).",
    });
    expect(intake({ description: "" })).toEqual({
      ok: false,
      message: "Describe the problem (max 5000 characters).",
    });
  });

  it("refuses an over-long title or description", () => {
    expect(intake({ title: "x".repeat(201) }).ok).toBe(false);
    expect(intake({ description: "x".repeat(5001) }).ok).toBe(false);
    expect(intake({ title: "x".repeat(200) }).ok).toBe(true);
  });
});
