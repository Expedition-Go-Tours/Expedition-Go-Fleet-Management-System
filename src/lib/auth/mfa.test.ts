import { describe, expect, it } from "vitest";

import { decideMfa } from "@/lib/auth/mfa";

describe("decideMfa", () => {
  const base = {
    privileged: true,
    mfaSatisfied: false,
    hasFactor: false,
    passwordChangeRequired: false,
    requireMfa: true,
  };

  it("lets a privileged user with a proven second factor in", () => {
    expect(decideMfa({ ...base, mfaSatisfied: true, hasFactor: true })).toBe("satisfied");
  });

  it("does not require MFA of non-privileged roles", () => {
    expect(decideMfa({ ...base, privileged: false })).toBe("not_required");
    expect(decideMfa({ ...base, privileged: false, hasFactor: true })).toBe("not_required");
  });

  it("rejects a privileged user who has a factor but did not prove it", () => {
    // This is the security-critical case: a password alone must not open a
    // privileged account that has a second factor enrolled.
    expect(decideMfa({ ...base, hasFactor: true })).toBe("reject");
    expect(decideMfa({ ...base, hasFactor: true, mfaSatisfied: false })).toBe("reject");
  });

  it("routes a privileged user with no factor to enroll rather than locking them out", () => {
    // Firebase only challenges when a factor exists, so a first-time user can
    // never produce mfaSatisfied. Without this they could never get in to enroll.
    expect(decideMfa({ ...base, hasFactor: false })).toBe("enroll");
  });

  it("exempts onboarding sessions that still have a temporary password", () => {
    expect(decideMfa({ ...base, passwordChangeRequired: true })).toBe("not_required");
    expect(decideMfa({ ...base, passwordChangeRequired: true, hasFactor: true })).toBe(
      "not_required",
    );
  });

  it("exempts everything when MFA is switched off (dev escape hatch)", () => {
    expect(decideMfa({ ...base, requireMfa: false })).toBe("not_required");
    expect(decideMfa({ ...base, requireMfa: false, hasFactor: true })).toBe("not_required");
    expect(decideMfa({ ...base, requireMfa: false, mfaSatisfied: true })).toBe("not_required");
  });

  it("always prefers a satisfied factor over a missing one", () => {
    expect(decideMfa({ ...base, mfaSatisfied: true, hasFactor: false })).toBe("satisfied");
  });

  it("never returns 'enroll' for a non-privileged role", () => {
    for (const hasFactor of [true, false]) {
      expect(decideMfa({ ...base, privileged: false, hasFactor })).toBe("not_required");
    }
  });

  it("covers every combination without throwing", () => {
    for (const privileged of [true, false]) {
      for (const mfaSatisfied of [true, false]) {
        for (const hasFactor of [true, false]) {
          for (const passwordChangeRequired of [true, false]) {
            for (const requireMfa of [true, false]) {
              const result = decideMfa({
                privileged,
                mfaSatisfied,
                hasFactor,
                passwordChangeRequired,
                requireMfa,
              });
              expect(["not_required", "satisfied", "enroll", "reject"]).toContain(result);
            }
          }
        }
      }
    }
  });
});
