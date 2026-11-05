import { describe, expect, it } from "vitest";

import {
  generateSessionToken,
  hashSessionToken,
  isPrivileged,
  isSessionActive,
  SESSION_COOKIE_MAX_AGE_SECONDS,
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

describe("privileged roles (MFA applies to them)", () => {
  it("marks ADMIN and OPERATIONS privileged", () => {
    expect(isPrivileged(["ADMIN", "DRIVER"])).toBe(true);
    expect(isPrivileged(["OPERATIONS"])).toBe(true);
  });

  it("leaves other roles unprivileged", () => {
    expect(isPrivileged(["DRIVER"])).toBe(false);
  });
});

describe("isSessionActive", () => {
  it("accepts a session that has never been revoked — sessions do not expire", () => {
    expect(isSessionActive({})).toBe(true);
    // A session idle for years stays valid; only revocation ends it.
    expect(isSessionActive({ revokedAt: undefined })).toBe(true);
  });

  it("rejects a revoked session", () => {
    expect(isSessionActive({ revokedAt: new Date("2026-01-01T09:30:00Z") })).toBe(false);
  });
});

describe("cookie lifetime", () => {
  it("uses the 400-day browser maximum, refreshed on navigation by proxy.ts", () => {
    expect(SESSION_COOKIE_MAX_AGE_SECONDS).toBe(400 * 24 * 60 * 60);
  });
});

describe("cookie naming", () => {
  it("uses the __Host- prefix only in secure contexts", () => {
    expect(sessionCookieName(true)).toBe("__Host-egt_session");
    expect(sessionCookieName(false)).toBe("egt_session");
  });
});
