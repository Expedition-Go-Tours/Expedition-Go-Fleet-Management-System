import { describe, expect, it } from "vitest";

import { isValidCronBearer } from "@/lib/api/cron";
import * as remindersRoute from "@/app/api/v1/cron/reminders/route";

/*
 * Scheduled-endpoint regression guards.
 *
 * Defect being pinned: Vercel Cron invokes configured paths with HTTP GET, but
 * the reminders route originally exported POST() only, so every scheduled run
 * returned 405 and no reminder was ever generated. If someone ever drops the
 * GET export again, the first test fails loudly.
 */

const SECRET = "s3cret-cron-token-value";

describe("cron reminders route — HTTP method contract", () => {
  it("exposes GET (Vercel Cron) and POST (internal/manual) handlers", () => {
    expect(typeof remindersRoute.GET).toBe("function");
    expect(typeof remindersRoute.POST).toBe("function");
  });
});

describe("isValidCronBearer", () => {
  it("accepts a correctly configured bearer token", () => {
    expect(isValidCronBearer(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a wrong token", () => {
    expect(isValidCronBearer("Bearer not-the-secret", SECRET)).toBe(false);
  });

  it("rejects a token that shares a prefix with the secret", () => {
    expect(isValidCronBearer(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
  });

  it("rejects a token that shares a suffix with the secret", () => {
    expect(isValidCronBearer(`Bearer ${SECRET.slice(1)}`, SECRET)).toBe(false);
  });

  it("rejects a missing Authorization header", () => {
    expect(isValidCronBearer(null, SECRET)).toBe(false);
  });

  it("rejects a non-bearer scheme", () => {
    expect(isValidCronBearer(`Basic ${SECRET}`, SECRET)).toBe(false);
    expect(isValidCronBearer(SECRET, SECRET)).toBe(false);
  });

  it("rejects an empty bearer token", () => {
    expect(isValidCronBearer("Bearer ", SECRET)).toBe(false);
    expect(isValidCronBearer("Bearer", SECRET)).toBe(false);
  });

  it("fails closed when the configured secret is empty", () => {
    expect(isValidCronBearer("Bearer ", "")).toBe(false);
    expect(isValidCronBearer("Bearer anything", "")).toBe(false);
  });

  it("does not throw on inputs of differing length (constant-time compare)", () => {
    expect(() => isValidCronBearer(`Bearer ${"x".repeat(4096)}`, SECRET)).not.toThrow();
  });
});
