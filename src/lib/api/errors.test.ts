import { describe, expect, it } from "vitest";

import { ApiError, toErrorResponse } from "@/lib/api/errors";
import { DomainError, statusForDomainCode } from "@/lib/domain/errors";
import { OdometerError } from "@/lib/repos/odometers";
import { AssignmentConflictError } from "@/lib/repos/assignments";
import { TripError } from "@/lib/repos/trips";

describe("statusForDomainCode", () => {
  it("maps missing records to 404", () => {
    expect(statusForDomainCode("READING_NOT_FOUND")).toBe(404);
    expect(statusForDomainCode("VEHICLE_NOT_FOUND")).toBe(404);
    expect(statusForDomainCode("NOT_FOUND")).toBe(404);
    expect(statusForDomainCode("WORK_ORDER_NOT_FOUND")).toBe(404);
  });

  it("maps bad input to 400", () => {
    expect(statusForDomainCode("VALIDATION_FAILED")).toBe(400);
    expect(statusForDomainCode("INVALID_KM")).toBe(400);
    expect(statusForDomainCode("INVALID_INPUT")).toBe(400);
  });

  it("maps conflicts with existing state to 409", () => {
    expect(statusForDomainCode("DECREASE_REJECTED")).toBe(409);
    expect(statusForDomainCode("HISTORICAL_ABOVE_PROJECTION")).toBe(409);
    expect(statusForDomainCode("ALREADY_CORRECTED")).toBe(409);
    expect(statusForDomainCode("ASSIGNMENT_CONFLICT")).toBe(409);
    // A wrong *state* is a conflict, not bad input.
    expect(statusForDomainCode("INVALID_STATUS")).toBe(409);
    expect(statusForDomainCode("ALREADY_COMPLETE")).toBe(409);
  });
});

describe("domain errors reach the client intact", () => {
  it("carries code, status and message", () => {
    const error = new OdometerError(
      "DECREASE_REJECTED",
      "Odometer cannot decrease: latest accepted reading is 51100 km, got 51080 km.",
    );
    expect(error.code).toBe("DECREASE_REJECTED");
    expect(error.status).toBe(409);
    expect(error.message).toContain("Odometer cannot decrease");
  });

  it("is recognised by the API error handler instead of becoming a 500", async () => {
    // Regression: these used to extend plain `Error`, so `toErrorResponse` did
    // not recognise them and replied "Something went wrong" with a 500 —
    // discarding a message written specifically for the person who needs it.
    const response = toErrorResponse(
      new OdometerError("DECREASE_REJECTED", "Odometer cannot decrease: latest is 51100 km."),
    );
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.error.code).toBe("DECREASE_REJECTED");
    expect(body.error.message).toContain("Odometer cannot decrease");
  });

  it("maps each domain error type correctly", () => {
    const cases: Array<[DomainError | AssignmentConflictError | TripError, number]> = [
      [new OdometerError("READING_NOT_FOUND", "Reading not found"), 404],
      [new OdometerError("INVALID_KM", "Km must be a whole number"), 400],
      [new AssignmentConflictError("Vehicle already has an active assignment"), 409],
      [new TripError("NOT_FOUND", "Trip not found"), 404],
      [new TripError("INVALID_STATUS", "Cannot edit a trip with status COMPLETED"), 409],
    ];
    for (const [error, expected] of cases) {
      expect(error.status, error.message).toBe(expected);
    }
  });

  it("still fails closed on genuinely unexpected errors", async () => {
    // A raw Error with no domain code must never leak internals.
    const response = toErrorResponse(new Error("ENOENT: no such file /srv/private/key.pem"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toBe("Something went wrong");
    expect(body.error.message).not.toContain("/srv/private");
  });

  it("passes ApiError through unchanged", async () => {
    const response = toErrorResponse(ApiError.conflict("Already archived"));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toBe("Already archived");
  });
});
