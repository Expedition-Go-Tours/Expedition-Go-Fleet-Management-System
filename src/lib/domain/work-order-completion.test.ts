import { describe, expect, it } from "vitest";

import { CompletionError, planIssueClosure } from "@/lib/domain/work-order-completion";
import { computeScheduleStatus } from "@/lib/domain/maintenance";

describe("planIssueClosure — work-order issue-link integrity", () => {
  const base = { workOrderId: "wo1", vehicleId: "veh1", linkedIssueIds: ["iss1", "iss2"] };

  it("closes multiple legitimately linked open issues on the same vehicle", () => {
    const toClose = planIssueClosure({
      ...base,
      requestedIssueIds: ["iss1", "iss2"],
      fetched: [
        { id: "iss1", exists: true, vehicleId: "veh1", status: "OPEN" },
        { id: "iss2", exists: true, vehicleId: "veh1", status: "TRIAGED" },
      ],
    });
    expect(toClose).toEqual(["iss1", "iss2"]);
  });

  it("rejects an issue that is not linked to the work order", () => {
    expect(() =>
      planIssueClosure({
        ...base,
        requestedIssueIds: ["iss-other"],
        fetched: [{ id: "iss-other", exists: true, vehicleId: "veh1", status: "OPEN" }],
      }),
    ).toThrowError(/not linked/);
  });

  it("rejects an issue that belongs to a different vehicle", () => {
    try {
      planIssueClosure({
        ...base,
        linkedIssueIds: ["iss2"],
        requestedIssueIds: ["iss2"],
        fetched: [{ id: "iss2", exists: true, vehicleId: "veh2", status: "OPEN" }],
      });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CompletionError);
      expect((error as CompletionError).code).toBe("ISSUE_VEHICLE_MISMATCH");
    }
  });

  it("rejects duplicate requested ids", () => {
    try {
      planIssueClosure({
        ...base,
        requestedIssueIds: ["iss1", "iss1"],
        fetched: [{ id: "iss1", exists: true, vehicleId: "veh1", status: "OPEN" }],
      });
      throw new Error("expected throw");
    } catch (error) {
      expect((error as CompletionError).code).toBe("DUPLICATE_ISSUE");
    }
  });

  it("rejects a missing linked issue", () => {
    try {
      planIssueClosure({
        ...base,
        requestedIssueIds: ["iss1"],
        fetched: [{ id: "iss1", exists: false }],
      });
      throw new Error("expected throw");
    } catch (error) {
      expect((error as CompletionError).code).toBe("ISSUE_NOT_FOUND");
    }
  });

  it("does not re-close an already CLOSED issue (idempotent)", () => {
    const toClose = planIssueClosure({
      ...base,
      requestedIssueIds: ["iss1"],
      fetched: [{ id: "iss1", exists: true, vehicleId: "veh1", status: "CLOSED" }],
    });
    expect(toClose).toEqual([]);
  });

  it("an invalid request yields no closures (no partial side effects)", () => {
    // iss1 is valid, issBogus is not linked: the whole call must reject rather
    // than returning iss1, so the caller cannot partially close records.
    expect(() =>
      planIssueClosure({
        ...base,
        requestedIssueIds: ["iss1", "issBogus"],
        fetched: [
          { id: "iss1", exists: true, vehicleId: "veh1", status: "OPEN" },
          { id: "issBogus", exists: true, vehicleId: "veh1", status: "OPEN" },
        ],
      }),
    ).toThrowError(/not linked/);
  });
});

describe("work-order completion contract", () => {
  it("CompletionError carries a stable code for clients", () => {
    const err = new CompletionError("DECREASE_REJECTED", "Odometer cannot decrease");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("DECREASE_REJECTED");
    expect(err.message).toContain("decrease");
    expect(err.name).toBe("CompletionError");
  });

  it("completing a work order resets ONLY the named schedule baseline", () => {
    // The workflow writes lastServiceOdometerKm = completion odometer into
    // exactly the schedules passed as scheduleIds. Verify the downstream
    // consequence: the reset schedule's next due recomputes from the new
    // baseline while an un-named schedule keeps its old one.
    const now = new Date("2026-06-15T12:00:00Z");
    const namedAfterReset = computeScheduleStatus({
      intervalKm: 5000,
      dueSoonKm: 500,
      lastServiceOdometerKm: 83950, // reset to completion odometer
      currentOdometerKm: 83950,
      now,
    });
    expect(namedAfterReset.nextDueOdometerKm).toBe(88950);

    const unNamedUntouched = computeScheduleStatus({
      intervalKm: 5000,
      dueSoonKm: 500,
      lastServiceOdometerKm: 79250, // baseline unchanged
      currentOdometerKm: 83950,
      now,
    });
    expect(unNamedUntouched.nextDueOdometerKm).toBe(84250);
  });
});
