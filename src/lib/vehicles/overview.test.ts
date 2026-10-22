import { describe, expect, it } from "vitest";

import { computeScheduleStatus } from "@/lib/domain/maintenance";
import type { MaintenanceSchedule } from "@/lib/repos/maintenance";
import { buildVehicleOverview, nextServiceLabel } from "@/lib/vehicles/overview";

/*
 * The vehicle summary is the screen a dispatcher reads before releasing a
 * vehicle. These tests pin what it says (and which tone) for the states that
 * change a decision: unassigned, safety-critical issue open, repair waiting on
 * parts, overdue service, cost recorded.
 */

const NOW = new Date("2026-10-22T12:00:00Z");

function schedule(overrides: Partial<MaintenanceSchedule> = {}): MaintenanceSchedule {
  return {
    id: "sch_1",
    vehicleId: "veh_1",
    taskName: "Oil change",
    category: "ENGINE",
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function evaluate(s: MaintenanceSchedule, currentOdometerKm = 16000) {
  const result = computeScheduleStatus({
    intervalKm: s.intervalKm ?? null,
    intervalDays: s.intervalDays ?? null,
    dueSoonKm: s.dueSoonKm ?? null,
    dueSoonDays: s.dueSoonDays ?? null,
    lastServiceOdometerKm: s.lastServiceOdometerKm ?? null,
    lastServiceDate: s.lastServiceDate ?? null,
    currentOdometerKm,
    now: NOW,
  });
  return { schedule: s, result };
}

function baseInput(overrides: Partial<Parameters<typeof buildVehicleOverview>[0]> = {}) {
  return {
    vehicleId: "veh_1",
    odometerKm: 16000,
    driverName: "Ama Mensah",
    openSafetyIssues: 0,
    openWorkOrders: 0,
    waitingWorkOrders: 0,
    nextService: { value: "On schedule", tone: "default" as const, hint: "Nothing due" },
    costToDateMinor: 63200,
    expenseCount: 2,
    ...overrides,
  };
}

describe("buildVehicleOverview", () => {
  it("returns the six facts in reading order", () => {
    const cells = buildVehicleOverview(baseInput());
    expect(cells.map((c) => c.key)).toEqual([
      "odometer",
      "driver",
      "next_service",
      "safety",
      "repairs",
      "cost",
    ]);
  });

  it("names the active driver, and says Unassigned when there is none", () => {
    const assigned = buildVehicleOverview(baseInput()).find((c) => c.key === "driver");
    expect(assigned?.value).toBe("Ama Mensah");
    expect(assigned?.tone).toBe("default");
    expect(assigned?.hint).toContain("Active assignment");

    const unassigned = buildVehicleOverview(baseInput({ driverName: null })).find(
      (c) => c.key === "driver",
    );
    expect(unassigned?.value).toBe("Unassigned");
    expect(unassigned?.tone).toBe("warning");
    expect(unassigned?.hint).toContain("No active assignment");
  });

  it("flags open safety-critical issues in the danger tone and links to them", () => {
    const clean = buildVehicleOverview(baseInput()).find((c) => c.key === "safety");
    expect(clean?.value).toBe("None open");
    expect(clean?.tone).toBe("default");

    const blocked = buildVehicleOverview(baseInput({ openSafetyIssues: 2 })).find(
      (c) => c.key === "safety",
    );
    expect(blocked?.value).toBe("2 open");
    expect(blocked?.tone).toBe("danger");
    expect(blocked?.hint).toContain("keep off the road");
    expect(blocked?.href).toBe("/reports?vehicleId=veh_1&open=1");
  });

  it("distinguishes repairs waiting on parts from repairs in hand", () => {
    const waiting = buildVehicleOverview(
      baseInput({ openWorkOrders: 2, waitingWorkOrders: 1 }),
    ).find((c) => c.key === "repairs");
    expect(waiting?.value).toBe("2");
    expect(waiting?.tone).toBe("warning");
    expect(waiting?.hint).toBe("1 waiting on parts");

    const inHand = buildVehicleOverview(baseInput({ openWorkOrders: 1 })).find(
      (c) => c.key === "repairs",
    );
    expect(inHand?.tone).toBe("default");
    expect(inHand?.hint).toBe("In the workshop");

    const none = buildVehicleOverview(baseInput()).find((c) => c.key === "repairs");
    expect(none?.hint).toBe("No open work orders");
  });

  it("shows recorded spend with a correct expense count", () => {
    const one = buildVehicleOverview(baseInput({ costToDateMinor: 4550, expenseCount: 1 })).find(
      (c) => c.key === "cost",
    );
    expect(one?.value).toBe("GH₵45.50");
    expect(one?.hint).toBe("1 recorded expense");
    expect(one?.href).toBe("/expenses?vehicleId=veh_1");

    const many = buildVehicleOverview(baseInput()).find((c) => c.key === "cost");
    expect(many?.value).toBe("GH₵632.00");
    expect(many?.hint).toBe("2 recorded expenses");
  });

  it("carries the maintenance verdict through unchanged", () => {
    const cell = buildVehicleOverview(
      baseInput({
        nextService: { value: "Oil change", tone: "danger", hint: "Overdue by 1,000 km" },
      }),
    ).find((c) => c.key === "next_service");
    expect(cell?.value).toBe("Oil change");
    expect(cell?.tone).toBe("danger");
    expect(cell?.hint).toBe("Overdue by 1,000 km");
  });
});

describe("nextServiceLabel", () => {
  it("says On schedule when nothing is due", () => {
    const result = nextServiceLabel(
      [evaluate(schedule({ intervalKm: 5000, lastServiceOdometerKm: 12000 }))],
      16000,
    );
    expect(result.value).toBe("On schedule");
    expect(result.tone).toBe("default");
  });

  it("ranks an overdue task above a due-soon one", () => {
    const dueSoon = evaluate(
      schedule({
        id: "s1",
        taskName: "Tyres",
        intervalKm: 5000,
        dueSoonKm: 500,
        lastServiceOdometerKm: 11400,
      }),
      16000,
    );
    const overdue = evaluate(
      schedule({
        id: "s2",
        taskName: "Oil change",
        intervalKm: 5000,
        lastServiceOdometerKm: 10000,
      }),
      16000,
    );

    const result = nextServiceLabel([dueSoon, overdue], 16000);
    expect(result.value).toBe("Oil change");
    expect(result.tone).toBe("danger");
    // Overdue by 1,000 km — reported as a magnitude, never a negative number.
    expect(result.hint).toContain("Overdue by 1,000 km");
    expect(result.hint).not.toContain("-1,000");
  });

  it("reports a due task in the accent tone with the distance left", () => {
    const result = nextServiceLabel(
      [evaluate(schedule({ intervalKm: 5000, lastServiceOdometerKm: 11000 }))],
      16000,
    );
    expect(result.tone).toBe("accent");
    expect(result.hint).toContain("Due in 0 km");
  });

  it("falls back to days for a time-based task", () => {
    const lastServiceDate = new Date("2026-07-14T00:00:00Z"); // 100 days before NOW
    const result = nextServiceLabel(
      [evaluate(schedule({ intervalDays: 90, lastServiceDate }))],
      16000,
    );
    expect(result.tone).toBe("danger");
    expect(result.hint).toContain("Overdue by 10 days");
  });

  it("surfaces an unconfigured schedule instead of hiding it", () => {
    const result = nextServiceLabel([evaluate(schedule())], 16000);
    expect(result.value).toBe("Not configured");
    expect(result.tone).toBe("default");
    expect(result.hint).toContain("baseline or interval");
  });
});
