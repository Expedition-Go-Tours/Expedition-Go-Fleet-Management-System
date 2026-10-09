import { describe, expect, it } from "vitest";

import { generateCsrfToken, isTrustedOrigin, safeEqual, verifyCsrf } from "@/lib/auth/csrf";

describe("verifyCsrf", () => {
  it("accepts a matching header/cookie pair", () => {
    const token = generateCsrfToken();
    expect(verifyCsrf(token, token)).toBe(true);
  });

  it("rejects mismatched, missing or empty tokens", () => {
    const token = generateCsrfToken();
    expect(verifyCsrf(token, "other")).toBe(false);
    expect(verifyCsrf(null, token)).toBe(false);
    expect(verifyCsrf(token, null)).toBe(false);
    expect(verifyCsrf("", "")).toBe(false);
  });
});

describe("safeEqual", () => {
  it("is constant-time tolerant: same values pass, different lengths fail", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("isTrustedOrigin", () => {
  const appUrl = "https://fleet.expeditiongotours.com";

  it("accepts the exact origin", () => {
    expect(isTrustedOrigin("https://fleet.expeditiongotours.com", appUrl)).toBe(true);
  });

  it("accepts the origin regardless of path", () => {
    expect(isTrustedOrigin("https://fleet.expeditiongotours.com/api/v1/auth/session", appUrl)).toBe(
      true,
    );
  });

  it("rejects other origins, null, and malformed values", () => {
    expect(isTrustedOrigin("https://evil.example.com", appUrl)).toBe(false);
    expect(isTrustedOrigin("http://fleet.expeditiongotours.com", appUrl)).toBe(false);
    expect(isTrustedOrigin(null, appUrl)).toBe(false);
    expect(isTrustedOrigin("not a url", appUrl)).toBe(false);
  });
});
