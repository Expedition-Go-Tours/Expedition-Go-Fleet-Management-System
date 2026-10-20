/**
 * Expected domain failures — a rejected odometer decrease, an already-cancelled
 * trip, an assignment conflict.
 *
 * These carry a clear message written specifically for the person who needs it.
 * They used to extend `Error`, which meant the API layer did not recognise them
 * and replied "Something went wrong" — discarding that message and reporting a
 * 500 for what is really a 409.
 *
 * This lives in its own module, deliberately without `next/server`, so domain
 * code and its unit tests never pull in the server runtime.
 */

/**
 * Map a domain failure code onto an HTTP status.
 *
 *   - "…NOT_FOUND"  → 404, the record is not there
 *   - bad input     → 400
 *   - anything else → 409, a conflict with existing state (a reading that would
 *                     go backwards, an already-corrected value, a trip already
 *                     cancelled, an assignment already live)
 */
export function statusForDomainCode(code: string): number {
  if (code.includes("NOT_FOUND")) return 404;
  if (code === "VALIDATION_FAILED" || code === "INVALID_KM" || code.startsWith("INVALID_INPUT")) {
    return 400;
  }
  return 409;
}

export class DomainError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = statusForDomainCode(code);
  }
}
