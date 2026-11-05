import { createHash, randomBytes } from "node:crypto";

import type { RoleKey } from "@/lib/auth/types";

/*
 * Session primitives. These are pure and server-only (they use node:crypto).
 *
 * The raw session token is 256 bits of CSPRNG output, base64url encoded. It is
 * sent to the browser in an opaque cookie and never stored. Firestore stores
 * only `hashSessionToken(token)`, which is also used as the document id so
 * validation is a single point read.
 *
 * Sessions are indefinite: there is no idle timeout and no absolute deadline,
 * so an active user stays signed in. Only explicit revocation (logout,
 * account disablement, password change) ends a session.
 */

/** Cookie name in secure contexts. The `__Host-` prefix pins host + path + Secure. */
export const HOST_SESSION_COOKIE = "__Host-egt_session";
export const HOST_CSRF_COOKIE = "__Host-egt_csrf";
/** Fallback names for local http development, where `__Host-` cannot be set. */
export const DEV_SESSION_COOKIE = "egt_session";
export const DEV_CSRF_COOKIE = "egt_csrf";

export const CSRF_HEADER = "x-csrf-token";

const TOKEN_BYTES = 32; // 256 bits

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Hash a session token for storage. Peppered with the server secret so a leaked
 * session collection cannot be used to reconstruct or brute-force tokens.
 */
export function hashSessionToken(token: string, secret: string): string {
  return createHash("sha256").update(`${secret}:${token}`).digest("hex");
}

export function sessionCookieName(secure: boolean): string {
  return secure ? HOST_SESSION_COOKIE : DEV_SESSION_COOKIE;
}

export function csrfCookieName(secure: boolean): string {
  return secure ? HOST_CSRF_COOKIE : DEV_CSRF_COOKIE;
}

/**
 * Persistent-cookie lifetime in seconds: 400 days, the maximum browsers allow
 * for `Max-Age`. `src/proxy.ts` re-issues the session and CSRF cookies with a
 * fresh window on every page navigation, so the cookie never lapses for an
 * active user even though sessions themselves never expire.
 */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/** Roles that require MFA. */
export const PRIVILEGED_ROLES: readonly RoleKey[] = ["ADMIN", "OPERATIONS"];

export function isPrivileged(roles: readonly RoleKey[]): boolean {
  return roles.some((role) => PRIVILEGED_ROLES.includes(role));
}

/** A session is invalid only once revoked. */
export function isSessionActive(session: { revokedAt?: Date }): boolean {
  return !session.revokedAt;
}

export function sessionCookieOptions(maxAgeSeconds: number, secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** CSRF cookie is intentionally readable by JavaScript for the double-submit check. */
export function csrfCookieOptions(secure: boolean, maxAgeSeconds: number) {
  return {
    httpOnly: false,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
