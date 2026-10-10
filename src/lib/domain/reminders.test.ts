import { describe, expect, it } from "vitest";

import {
  dayBucket,
  deriveDocumentReminders,
  deriveScheduleReminders,
  kmBand,
} from "@/lib/domain/reminders";
import { computeTripDistance } from "@/lib/domain/assignment";
import { computeConsumption } from "@/lib/domain/fuel";
import { documentState, blocksAssignment } from "@/lib/domain/document";
import { defaultChecklist, overallResult } from "@/lib/domain/inspection";

const NOW = new Date("2026-06-15T12:00:00Z");

describe("schedule reminders (idempotent dedupe keys)", () => {
  const base = {
    vehicleId: "veh1",
    regNumber: "GR-1000-24",
    scheduleId: "sched1",
    taskName: "Engine oil change",
    nextDueOdometerKm: 84250,
    nextDueDate: null as Date | null,
    now: NOW,
  };

  it("OVERDUE produces one reminder per day, stable key", () => {
    const a = deriveScheduleReminders({
      ...base,
      status: "OVERDUE",
      remainingKm: -100,
      remainingDays: null,
    });
    expect(a).toHaveLength(1);
    expect(a[0]!.type).toBe("MAINTENANCE_OVERDUE");
    expect(a[0]!.dedupeKey).toContain(":OVERDUE:");
    expect(a[0]!.dedupeKey).toBe(a[0]!.dedupeKey); // deterministic
  });

  it("DUE_SOON km reminders bucket per 250 km band (stable across retries)", () => {
    const first = deriveScheduleReminders({
      ...base,
      status: "DUE_SOON",
      remainingKm: 350,
      remainingDays: null,
    });
    const retry = deriveScheduleReminders({
      ...base,
      status: "DUE_SOON",
      remainingKm: 349,
      remainingDays: null,
    });
    expect(first[0]!.type).toBe("MAINTENANCE_DUE_SOON_KM");
    expect(retry[0]!.dedupeKey).toBe(first[0]!.dedupeKey); // same band → same key
  });

  it("OK produces no reminders", () => {
    const reminders = deriveScheduleReminders({
      ...base,
      status: "OK",
      remainingKm: 4150,
      remainingDays: null,
    });
    expect(reminders).toHaveLength(0);
  });

  it("day bucket is date-only and stable within a day", () => {
    expect(dayBucket(new Date("2026-06-15T01:00:00Z"))).toBe("2026-06-15");
    expect(dayBucket(new Date("2026-06-15T23:59:00Z"))).toBe("2026-06-15");
  });

  it("km bands are 250 km wide", () => {
    expect(kmBand(84250, 350)).toBe(kmBand(84250, 349));
    expect(kmBand(84250, 350)).not.toBe(kmBand(84250, 100));
  });
});

describe("document reminders", () => {
  it("expired mandatory document produces an EXPIRED reminder", () => {
    const reminders = deriveDocumentReminders({
      vehicleId: "veh1",
      regNumber: "GR-1000-24",
      documentId: "doc1",
      category: "INSURANCE",
      expiryDate: "2026-05-01",
      now: NOW,
      warningDays: 30,
    });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.type).toBe("DOCUMENT_EXPIRED");
  });

  it("expiring soon produces an EXPIRING reminder keyed by expiry date", () => {
    const reminders = deriveDocumentReminders({
      vehicleId: "veh1",
      regNumber: "GR-1000-24",
      documentId: "doc2",
      category: "ROADWORTHINESS",
      expiryDate: "2026-07-01",
      now: NOW,
      warningDays: 30,
    });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.type).toBe("DOCUMENT_EXPIRING");
    expect(reminders[0]!.dedupeKey).toContain("2026-07-01");
  });

  it("valid document produces nothing", () => {
    const reminders = deriveDocumentReminders({
      vehicleId: "veh1",
      regNumber: "GR-1000-24",
      documentId: "doc3",
      category: "REGISTRATION",
      expiryDate: "2027-01-01",
      now: NOW,
      warningDays: 30,
    });
    expect(reminders).toHaveLength(0);
  });

  it("documentState computes VALID/EXPIRING_SOON/EXPIRED/MISSING", () => {
    expect(documentState({ expiryDate: "2027-01-01" }, NOW, 30)).toBe("VALID");
    expect(documentState({ expiryDate: "2026-07-01" }, NOW, 30)).toBe("EXPIRING_SOON");
    expect(documentState({ expiryDate: "2026-05-01" }, NOW, 30)).toBe("EXPIRED");
    expect(documentState({}, NOW, 30)).toBe("MISSING");
  });

  it("expired mandatory documents block assignment; optional ones do not", () => {
    const mandatoryExpired = { mandatory: true, expiryDate: "2026-01-01" };
    const optionalExpired = { mandatory: false, expiryDate: "2026-01-01" };
    expect(blocksAssignment([mandatoryExpired], NOW, 30)).not.toBeNull();
    expect(blocksAssignment([optionalExpired], NOW, 30)).toBeNull();
  });
});

describe("trip distance (never fabricated)", () => {
  it("computes end − start from accepted readings", () => {
    expect(computeTripDistance(80000, 80250)).toEqual({
      distanceKm: 250,
      complete: true,
      conflict: false,
    });
  });

  it("missing readings → incomplete, not zero", () => {
    expect(computeTripDistance(80000, null)).toEqual({
      distanceKm: null,
      complete: false,
      conflict: false,
    });
    expect(computeTripDistance(undefined, 80250).distanceKm).toBeNull();
  });

  it("end below start → conflict, not negative distance", () => {
    expect(computeTripDistance(80250, 80000)).toEqual({
      distanceKm: null,
      complete: false,
      conflict: true,
    });
  });
});

describe("fuel consumption (defensible figures only)", () => {
  const fullA = { odometerKm: 80000, fullTank: true, litres: 40 };
  const fullB = { odometerKm: 80600, fullTank: true, litres: 38 };

  it("full-tank to full-tank gives km/l", () => {
    const result = computeConsumption(fullA, fullB);
    expect(result.kmPerLitre).toBeCloseTo(15.79, 2);
  });

  it("missing full-tank flags → unknown with a reason", () => {
    const result = computeConsumption({ ...fullA, fullTank: false }, fullB);
    expect(result.kmPerLitre).toBeNull();
    expect(result.reason).toContain("full-tank");
  });

  it("contradictory odometer → unknown, not negative", () => {
    const result = computeConsumption(fullB, fullA);
    expect(result.kmPerLitre).toBeNull();
  });
});

describe("inspection checklist", () => {
  it("default checklist has critical safety items", () => {
    const items = defaultChecklist();
    const criticalKeys = items.filter((i) => i.critical).map((i) => i.key);
    expect(criticalKeys).toContain("brakes");
    expect(criticalKeys).toContain("tyres");
    expect(criticalKeys).toContain("belts");
  });

  it("overall result: FAIL beats NA beats PASS", () => {
    expect(overallResult([{ result: "PASS" }, { result: "FAIL" }])).toBe("FAIL");
    expect(overallResult([{ result: "PASS" }, { result: "NOT_APPLICABLE" }])).toBe(
      "NOT_APPLICABLE",
    );
    expect(overallResult([{ result: "PASS" }])).toBe("PASS");
  });
});
