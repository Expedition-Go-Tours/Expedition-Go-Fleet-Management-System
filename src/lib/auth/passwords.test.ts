import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/errors";
import {
  assertValidPassword,
  generateTempPassword,
  validatePassword,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} from "@/lib/auth/passwords";

describe("generateTempPassword", () => {
  it("produces a password meeting the policy", () => {
    const pwd = generateTempPassword();
    expect(typeof pwd).toBe("string");
    const result = validatePassword(pwd);
    expect(result.ok).toBe(true);
  });

  it("is unpredictable (distinct across calls)", () => {
    const a = generateTempPassword();
    const b = generateTempPassword();
    expect(a).not.toBe(b);
  });

  it("has sufficient length", () => {
    const pwd = generateTempPassword();
    expect(pwd.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
  });
});

describe("validatePassword", () => {
  it("accepts a valid password with 3 of 4 character classes", () => {
    // lowercase + uppercase + digit
    expect(validatePassword("Abcdef123456").ok).toBe(true);
    // lowercase + uppercase + symbol
    expect(validatePassword("Abcdefghijkl!").ok).toBe(true);
    // lowercase + digit + symbol
    expect(validatePassword("abcdefghi123!").ok).toBe(true);
    // uppercase + digit + symbol
    expect(validatePassword("ABCDEFGH123!").ok).toBe(true);
  });

  it("rejects passwords with only 2 character classes", () => {
    expect(validatePassword("abcdefghijkl").ok).toBe(false); // lowercase only
    expect(validatePassword("ABCDEFGHIJKL").ok).toBe(false); // uppercase only
    expect(validatePassword("123456789012").ok).toBe(false); // digits only
    expect(validatePassword("abcdefghijklmn").ok).toBe(false); // lower+? no
    expect(validatePassword("ABCDEFGHIJKLmn").ok).toBe(false); // lower+upper only
    expect(validatePassword("abcdefghij1234").ok).toBe(false); // lower+digits only
    expect(validatePassword("ABCDEFGHIJ1234").ok).toBe(false); // upper+digits only
  });

  it("enforces minimum length", () => {
    expect(validatePassword("Abc1").ok).toBe(false); // too short
    expect(validatePassword("Abcdefghij1!").ok).toBe(true); // exactly 12
  });

  it("enforces maximum length", () => {
    const long = "A".repeat(MAX_PASSWORD_LENGTH + 1) + "1!";
    expect(validatePassword(long).ok).toBe(false);
    const maxOk = "A".repeat(MAX_PASSWORD_LENGTH - 3) + "b1!";
    expect(validatePassword(maxOk).ok).toBe(true);
  });

  it("returns specific error messages", () => {
    const result = validatePassword("short");
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    expect(result.errors).toContain(
      "Password must contain at least 3 of: lowercase, uppercase, digit, symbol",
    );
  });
});

describe("assertValidPassword", () => {
  it("returns the password when valid", () => {
    expect(assertValidPassword("ValidPass123!")).toBe("ValidPass123!");
  });

  it("throws ApiError with 400 when invalid", () => {
    expect(() => assertValidPassword("weak")).toThrow(ApiError);
    expect(() => assertValidPassword("weak")).toThrow(/12/);
  });
});
