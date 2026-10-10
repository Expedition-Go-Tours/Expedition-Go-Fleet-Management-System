import { describe, expect, it } from "vitest";

import { computeScheduleStatus } from "@/lib/domain/maintenance";

/*
 * Mandated oil-change boundary tests:
 *   last completed 79,250 km, interval 5,000 km, due-soon 500 km
 *   → next due 84,250 km
 */

const NOW = new Date("2026-06-15T12:00:00Z");

function oilChange(currentOdometerKm: number) {
  return computeScheduleStatus({
    intervalKm: 5000,
    dueSoonKm: 500,
    lastServiceOdometerKm: 79250,
    currentOdometerKm,
    now: NOW,
  });
}

describe("oil-change schedule (mandated example)", () => {
  it("calculates next due at 84,250 km", () => {
    expect(oilChange(79250).nextDueOdometerKm).toBe(84250);
  });

  it("is OK at 83,749 km (one km before the due-soon threshold)", () => {
    const r = oilChange(83749);
    expect(r.status).toBe("OK");
    expect(r.remainingKm).toBe(501);
  });

  it("becomes DUE_SOON exactly at 83,750 km", () => {
    const r = oilChange(83750);
    expect(r.status).toBe("DUE_SOON");
    expect(r.remainingKm).toBe(500);
  });

  it("is DUE exactly at 84,250 km", () => {
    const r = oilChange(84250);
    expect(r.status).toBe("DUE");
    expect(r.remainingKm).toBe(0);
  });

  it("is OVERDUE above 84,250 km", () => {
    expect(oilChange(84251).status).toBe("OVERDUE");
    expect(oilChange(84251).remainingKm).toBe(-1);
  });
});

describe("time-based and combined limits", () => {
  it("date limit alone can make a task DUE before its km limit", () => {
    // Last service 2026-01-01, 30-day interval → due 2026-01-31 (overdue at NOW),
    // but km remaining is large.
    const r = computeScheduleStatus({
      intervalKm: 10000,
      dueSoonKm: 500,
      intervalDays: 30,
      dueSoonDays: 7,
      lastServiceOdometerKm: 0,
      currentOdometerKm: 1000,
      lastServiceDate: new Date("2026-01-01T00:00:00Z"),
      now: NOW,
    });
    expect(r.odometerState).toBe("OK");
    expect(r.timeState).toBe("OVERDUE");
    expect(r.status).toBe("OVERDUE");
  });

  it("never shows OK when one configured limit is overdue", () => {
    const r = computeScheduleStatus({
      intervalKm: 50000, // km far from due
      dueSoonKm: 500,
      intervalDays: 90, // time overdue
      dueSoonDays: 10,
      lastServiceOdometerKm: 0,
      currentOdometerKm: 1000,
      lastServiceDate: new Date("2026-01-01T00:00:00Z"),
      now: NOW,
    });
    expect(r.status).not.toBe("OK");
    expect(r.status).toBe("OVERDUE");
  });

  it("whichever limit is reached first wins", () => {
    // Time limit (30 days from 2026-06-01 → 2026-07-01) not yet due;
    // km limit due at 10,000 and current is 9,800 → DUE_SOON.
    const r = computeScheduleStatus({
      intervalKm: 9000,
      dueSoonKm: 500,
      intervalDays: 60,
      dueSoonDays: 7,
      lastServiceOdometerKm: 1000,
      currentOdometerKm: 9500,
      lastServiceDate: new Date("2026-06-01T00:00:00Z"),
      now: NOW,
    });
    expect(r.odometerState).toBe("DUE_SOON");
    expect(r.timeState).toBe("OK");
    expect(r.status).toBe("DUE_SOON");
  });
});

describe("incomplete configuration", () => {
  it("NOT_CONFIGURED when no interval is set", () => {
    const r = computeScheduleStatus({ now: NOW });
    expect(r.status).toBe("NOT_CONFIGURED");
    expect(r.computed).toBe(false);
    expect(r.note).toBeTruthy();
  });

  it("NOT_CONFIGURED when a km interval lacks its baseline", () => {
    const r = computeScheduleStatus({
      intervalKm: 5000,
      dueSoonKm: 500,
      currentOdometerKm: 100000,
      now: NOW,
    });
    expect(r.status).toBe("NOT_CONFIGURED");
    expect(r.computed).toBe(false);
    expect(r.note).toContain("baseline");
  });

  it("NOT_CONFIGURED when a time interval lacks the last service date", () => {
    const r = computeScheduleStatus({
      intervalDays: 90,
      lastServiceOdometerKm: 1000,
      currentOdometerKm: 1000,
      now: NOW,
    });
    expect(r.status).toBe("NOT_CONFIGURED");
    expect(r.computed).toBe(false);
  });

  it("computes the configured limit when only one is present", () => {
    const r = computeScheduleStatus({
      intervalKm: 5000,
      lastServiceOdometerKm: 79250,
      currentOdometerKm: 80000,
      now: NOW,
    });
    expect(r.computed).toBe(true);
    expect(r.status).toBe("OK");
    expect(r.timeState).toBeNull();
  });

  it("flags partial configuration while still computing the usable limit", () => {
    const r = computeScheduleStatus({
      intervalKm: 5000,
      intervalDays: 90,
      lastServiceOdometerKm: 79250,
      currentOdometerKm: 84250,
      now: NOW,
    });
    expect(r.computed).toBe(true);
    expect(r.status).toBe("DUE");
    expect(r.note).toContain("Partially configured");
  });
});

describe("each task keeps its own baseline (no cross-reset)", () => {
  it("two tasks on one vehicle calculate independently", () => {
    const oil = computeScheduleStatus({
      intervalKm: 5000,
      lastServiceOdometerKm: 84250, // just completed
      currentOdometerKm: 84250,
      now: NOW,
    });
    const brakes = computeScheduleStatus({
      intervalKm: 10000,
      dueSoonKm: 1000,
      lastServiceOdometerKm: 79250, // older baseline: due at 89,250
      currentOdometerKm: 84250,
      now: NOW,
    });
    expect(oil.status).toBe("OK");
    expect(brakes.status).toBe("OK"); // 5,000 km remaining, outside the 1,000 km warning
    const brakesSoon = computeScheduleStatus({
      intervalKm: 10000,
      dueSoonKm: 6000,
      lastServiceOdometerKm: 79250,
      currentOdometerKm: 84250,
      now: NOW,
    });
    expect(brakesSoon.status).toBe("DUE_SOON"); // inside its own warning threshold
  });
});

describe("boundary precision", () => {
  it("uses day precision for time limits (due on the due date itself)", () => {
    const r = computeScheduleStatus({
      intervalDays: 30,
      dueSoonDays: 0,
      lastServiceDate: new Date("2026-05-16T00:00:00Z"), // +30 days = 2026-06-15
      now: NOW, // 2026-06-15
    });
    expect(r.timeState).toBe("DUE");
  });
});
