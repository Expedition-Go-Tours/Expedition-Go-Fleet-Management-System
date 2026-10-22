import { describe, expect, it } from "vitest";

import { ServiceLogError, planServiceLogging } from "@/lib/domain/service-logging";

const base = {
  vehicleId: "veh1",
  workPerformed: "Changed engine oil and filter, checked brakes.",
  completedAt: new Date("2026-10-20T12:00:00Z"),
};

describe("planServiceLogging — direct service logging pre-checks", () => {
  const schedule = (id: string, vehicleId = "veh1", taskName = "Oil & filter change") => ({
    id,
    exists: true,
    vehicleId,
    taskName,
  });

  it("labels the record by the first serviced schedule task", () => {
    const plan = planServiceLogging({
      ...base,
      explicitTaskName: "Garage visit",
      fetchedSchedules: [schedule("sch1"), schedule("sch2", "veh1", "Brake inspection")],
      requestedScheduleIds: ["sch1", "sch2"],
    });
    expect(plan.taskName).toBe("Oil & filter change");
  });

  it("falls back to the caller's label, then the work performed itself", () => {
    const labelled = planServiceLogging({
      ...base,
      explicitTaskName: "Garage visit",
      fetchedSchedules: [],
      requestedScheduleIds: [],
    });
    expect(labelled.taskName).toBe("Garage visit");

    const unlabelled = planServiceLogging({
      ...base,
      fetchedSchedules: [],
      requestedScheduleIds: [],
    });
    expect(unlabelled.taskName).toBe("Changed engine oil and filter, checked brakes.");

    const truncated = planServiceLogging({
      ...base,
      workPerformed: "x".repeat(250),
      fetchedSchedules: [],
      requestedScheduleIds: [],
    });
    expect(truncated.taskName).toHaveLength(100);
  });

  it("never resets a schedule merely because it was named", () => {
    // Codes are captured directly: a helper that also reports "NO_THROW" keeps
    // these assertions honest — they fail if the guard is ever removed.
    const codeOf = (requestedScheduleIds: string[], fetchedSchedules: unknown[]) => {
      try {
        planServiceLogging({
          ...base,
          fetchedSchedules: (fetchedSchedules as never) ?? [],
          requestedScheduleIds,
        });
        return "NO_THROW";
      } catch (err) {
        return (err as ServiceLogError).code;
      }
    };

    expect(codeOf(["sch9"], [{ id: "sch9", exists: false }])).toBe("SCHEDULE_NOT_FOUND");
    expect(
      codeOf(["sch1"], [{ id: "sch1", exists: true, vehicleId: "veh_other", taskName: "Oil" }]),
    ).toBe("SCHEDULE_VEHICLE_MISMATCH");
    expect(
      codeOf(["sch1", "sch1"], [{ id: "sch1", exists: true, vehicleId: "veh1", taskName: "Oil" }]),
    ).toBe("DUPLICATE_SCHEDULE");
  });
});
