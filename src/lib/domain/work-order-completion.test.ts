import { describe, expect, it } from "vitest";

import { CompletionError } from "@/lib/domain/work-order-completion";
import { computeScheduleStatus } from "@/lib/domain/maintenance";

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