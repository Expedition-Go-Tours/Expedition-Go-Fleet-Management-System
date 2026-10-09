import { randomBytes } from "node:crypto";

import { ApiError } from "@/lib/api/errors";

/*
 * Password policy + temporary-password generation.
 *
 * Temporary passwords are issued to invited staff members and shared out-of-band
 * (phone/WhatsApp). The invitee must change the password on first sign-in — the
 * change is enforced server-side by the `mustChangePassword` flag on the user
 * document and the `mustChangePassword` snapshot on the session record.
 */

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/** Ambiguous characters (0/O, 1/l/I) are excluded from the temp alphabet. */
const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
const TEMP_PASSWORD_LENGTH = 16;

/** Generate a cryptographically random temporary password that passes the policy. */
export function generateTempPassword(): string {
  const bytes = randomBytes(TEMP_PASSWORD_LENGTH);
  let password = "";
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
    password += TEMP_PASSWORD_ALPHABET[bytes[i]! % TEMP_PASSWORD_ALPHABET.length];
  }
  // Guarantee the policy is met even though the alphabet is already 4-class.
  const check = validatePassword(password);
  if (!check.ok) {
    return generateTempPassword();
  }
  return password;
}

export interface PasswordPolicyResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a candidate password against the project policy:
 *  - 12–128 characters
 *  - At least 3 of: lowercase, uppercase, digit, symbol
 */
export function validatePassword(password: unknown): PasswordPolicyResult {
  const errors: string[] = [];
  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, errors: ["Password must be a string"] };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    errors.push(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) {
    errors.push("Password must contain at least 3 of: lowercase, uppercase, digit, symbol");
  }
  return { ok: errors.length === 0, errors };
}

/** Throw a 400 if the password fails the policy; return it otherwise. */
export function assertValidPassword(password: unknown): string {
  const result = validatePassword(password);
  if (!result.ok) {
    throw ApiError.badRequest(result.errors.join("; "));
  }
  return password as string;
}
