import { randomBytes, timingSafeEqual } from "node:crypto";

/*
 * CSRF protection: a double-submit token combined with strict Origin checks.
 * The token is issued alongside the session, stored in a readable cookie, and
 * echoed by the client in the `x-csrf-token` header on every state-changing
 * request. SameSite=Lax is defense in depth, not the only control.
 */

export function generateCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Exact-origin match of a request Origin against the app's own origin. */
export function isTrustedOrigin(origin: string | null, appUrl: string): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

/** Validate the double-submit pair. */
export function verifyCsrf(headerToken: string | null, cookieToken: string | null): boolean {
  if (!headerToken || !cookieToken) return false;
  return safeEqual(headerToken, cookieToken);
}
