import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import { clearRateLimit, clientAddress, enforceRateLimit, RATE_LIMITS } from "@/lib/api/rate-limit";

describe("enforceRateLimit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to the limit and blocks the one after", () => {
    const key = `t1-${Math.random()}`;
    const rule = { limit: 3, windowMs: 60_000 };

    expect(() => enforceRateLimit(key, rule)).not.toThrow();
    expect(() => enforceRateLimit(key, rule)).not.toThrow();
    expect(() => enforceRateLimit(key, rule)).not.toThrow();
    expect(() => enforceRateLimit(key, rule)).toThrow(ApiError);
  });

  it("returns a 429 with a machine-readable code", () => {
    const key = `t2-${Math.random()}`;
    const rule = { limit: 1, windowMs: 60_000 };
    enforceRateLimit(key, rule);
    try {
      enforceRateLimit(key, rule);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(429);
      expect((error as ApiError).code).toBe("RATE_LIMITED");
    }
  });

  it("starts a fresh window once the old one expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const key = `t3-${Math.random()}`;
    const rule = { limit: 1, windowMs: 10_000 };

    enforceRateLimit(key, rule);
    expect(() => enforceRateLimit(key, rule)).toThrow();

    // Just before the window ends it is still blocked...
    vi.advanceTimersByTime(9_999);
    expect(() => enforceRateLimit(key, rule)).toThrow();

    // ...and allowed again after it.
    vi.advanceTimersByTime(2);
    expect(() => enforceRateLimit(key, rule)).not.toThrow();
  });

  it("keeps separate callers on separate budgets", () => {
    const rule = { limit: 1, windowMs: 60_000 };
    enforceRateLimit(`t4-a-${Math.random()}`, rule);
    // A different key must be unaffected by the first one's usage.
    expect(() => enforceRateLimit(`t4-b-${Math.random()}`, rule)).not.toThrow();
  });

  it("tells the caller when to retry", () => {
    const key = `t5-${Math.random()}`;
    enforceRateLimit(key, { limit: 1, windowMs: 60_000 });
    try {
      enforceRateLimit(key, { limit: 1, windowMs: 60_000 });
    } catch (error) {
      expect((error as ApiError).message).toMatch(/Try again in \d+ seconds?/);
    }
  });

  it("frees the budget again when an attempt succeeds", () => {
    // Success must not consume budget, or a small office behind one NAT would
    // lock itself out just by everyone signing in.
    const key = `t6-${Math.random()}`;
    const rule = { limit: 2, windowMs: 60_000 };
    enforceRateLimit(key, rule);
    enforceRateLimit(key, rule);
    expect(() => enforceRateLimit(key, rule)).toThrow();

    clearRateLimit(key);
    expect(() => enforceRateLimit(key, rule)).not.toThrow();
    expect(() => enforceRateLimit(key, rule)).not.toThrow();
    expect(() => enforceRateLimit(key, rule)).toThrow();
  });

  it("ships sensible production budgets", () => {
    // Sign-in is the brute-force target, so it is the tightest.
    expect(RATE_LIMITS.signIn.limit).toBeLessThanOrEqual(RATE_LIMITS.upload.limit);
    expect(RATE_LIMITS.signIn.windowMs).toBeGreaterThan(0);
    expect(RATE_LIMITS.passwordChange.limit).toBeLessThanOrEqual(RATE_LIMITS.signIn.limit);
    for (const rule of Object.values(RATE_LIMITS)) {
      expect(rule.limit).toBeGreaterThan(0);
      expect(rule.windowMs).toBeGreaterThan(0);
    }
  });
});

describe("clientAddress", () => {
  it("uses the first address in the forwarding header", () => {
    const request = new Request("https://example.test", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(clientAddress(request)).toBe("203.0.113.7");
  });

  it("falls back to a shared bucket rather than trusting nothing", () => {
    const request = new Request("https://example.test");
    expect(clientAddress(request)).toBe("unknown");
  });

  it("ignores an empty forwarding header", () => {
    const request = new Request("https://example.test", {
      headers: { "x-forwarded-for": "   " },
    });
    expect(clientAddress(request)).toBe("unknown");
  });
});
