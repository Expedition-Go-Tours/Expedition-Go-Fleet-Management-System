import { describe, expect, it } from "vitest";

import {
  ServiceLogError,
  planServiceLogging,
  resolveServiceOdometer,
} from "@/lib/domain/service-logging";

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

describe("resolveServiceOdometer — optional reading for direct service logs", () => {
  it("treats absent and blank values as no reading, never as 0", () => {
    expect(resolveServiceOdometer(undefined)).toBeUndefined();
    expect(resolveServiceOdometer(null)).toBeUndefined();
    expect(resolveServiceOdometer("")).toBeUndefined();
    expect(resolveServiceOdometer("   ")).toBeUndefined();
  });

  it("accepts a whole kilometre reading from JSON numbers or form strings", () => {
    expect(resolveServiceOdometer(128500)).toBe(128500);
    expect(resolveServiceOdometer("128500")).toBe(128500);
    expect(resolveServiceOdometer(0)).toBe(0);
  });

  it("rejects malformed readings loudly instead of dropping them", () => {
    const codeOf = (value: unknown) => {
      try {
        resolveServiceOdometer(value);
        return "NO_THROW";
      } catch (err) {
        return (err as ServiceLogError).code;
      }
    };

    expect(codeOf(-1)).toBe("INVALID_ODOMETER");
    expect(codeOf(1.5)).toBe("INVALID_ODOMETER");
    expect(codeOf("abc")).toBe("INVALID_ODOMETER");
    expect(codeOf(true)).toBe("INVALID_ODOMETER");
    expect(codeOf(Number.MAX_SAFE_INTEGER + 1)).toBe("INVALID_ODOMETER");
  });
});
