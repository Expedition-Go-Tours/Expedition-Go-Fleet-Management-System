import { describe, expect, it } from "vitest";

import {
  computeSessionExpiry,
  generateSessionToken,
  hashSessionToken,
  isPrivileged,
  isSessionActive,
  policyForRoles,
  SESSION_POLICIES,
  sessionCookieName,
} from "@/lib/auth/session";

const SECRET = "test-secret";

describe("generateSessionToken", () => {
  it("produces 256-bit base64url tokens", () => {
    const token = generateSessionToken();
    expect(token).toBeTypeOf("string");
    // 32 bytes → 43 base64url chars (no padding).
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is unpredictable (distinct across calls)", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
  });
});

describe("hashSessionToken", () => {
  it("is deterministic for the same token and secret", () => {
    expect(hashSessionToken("token", SECRET)).toBe(hashSessionToken("token", SECRET));
  });

  it("differs when the secret changes (peppering)", () => {
    expect(hashSessionToken("token", "secret-a")).not.toBe(hashSessionToken("token", "secret-b"));
  });

  it("never reveals the raw token", () => {
    const token = "super-secret-token-value";
    const hash = hashSessionToken(token, SECRET);
    expect(hash).not.toContain(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("policy selection ($4.2)", () => {
  it("uses the shorter privileged policy for ADMIN/MANAGER/FINANCE", () => {
    expect(policyForRoles(["ADMIN"])).toEqual(SESSION_POLICIES.privileged);
    expect(policyForRoles(["MANAGER"])).toEqual(SESSION_POLICIES.privileged);
    expect(policyForRoles(["FINANCE"])).toEqual(SESSION_POLICIES.privileged);
    expect(isPrivileged(["ADMIN", "DRIVER"])).toBe(true);
  });

  it("uses the standard policy for other roles", () => {
    expect(policyForRoles(["DRIVER"])).toEqual(SESSION_POLICIES.standard);
    expect(policyForRoles(["OPERATIONS", "MAINTENANCE"])).toEqual(SESSION_POLICIES.standard);
    expect(isPrivileged(["DRIVER"])).toBe(false);
  });
});

describe("isSessionActive", () => {
  const active = {
    idleExpiresAt: new Date("2026-01-01T10:00:00Z"),
    expiresAt: new Date("2026-01-01T12:00:00Z"),
  };

  it("accepts a live session", () => {
    expect(isSessionActive(active, new Date("2026-01-01T09:00:00Z"))).toBe(true);
  });

  it("rejects a revoked session even if unexpired", () => {
    expect(
      isSessionActive(
        { ...active, revokedAt: new Date("2026-01-01T09:30:00Z") },
        new Date("2026-01-01T09:00:00Z"),
      ),
    ).toBe(false);
  });

  it("rejects a session past its absolute deadline", () => {
    expect(isSessionActive(active, new Date("2026-01-01T12:00:00Z"))).toBe(false);
  });

  it("rejects a session past its idle deadline", () => {
    expect(isSessionActive(active, new Date("2026-01-01T10:00:00Z"))).toBe(false);
  });
});

describe("computeSessionExpiry", () => {
  it("sets the sliding idle window from now and the absolute window from the anchor", () => {
    const now = new Date("2026-01-01T09:00:00Z");
    const firstSeen = new Date("2026-01-01T08:00:00Z");
    const expiry = computeSessionExpiry(now, SESSION_POLICIES.standard, firstSeen);
    expect(expiry.idleExpiresAt.toISOString()).toBe("2026-01-01T10:00:00.000Z");
    // Absolute lifetime anchored to session creation, not to this request.
    expect(expiry.expiresAt.toISOString()).toBe("2026-01-01T20:00:00.000Z");
  });
});

describe("cookie naming", () => {
  it("uses the __Host- prefix only in secure contexts", () => {
    expect(sessionCookieName(true)).toBe("__Host-egt_session");
    expect(sessionCookieName(false)).toBe("egt_session");
  });
});
