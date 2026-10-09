import { createHash, randomBytes } from "node:crypto";

import type { RoleKey } from "@/lib/auth/types";

/*
 * Session primitives. These are pure and server-only (they use node:crypto).
 *
 * The raw session token is 256 bits of CSPRNG output, base64url encoded. It is
 * sent to the browser in an opaque cookie and never stored. Firestore stores
 * only `hashSessionToken(token)`, which is also used as the document id so
 * validation is a single point read.
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

export interface SessionPolicy {
  idleMs: number;
  absoluteMs: number;
}

export const SESSION_POLICIES = {
  standard: { idleMs: 60 * 60 * 1000, absoluteMs: 12 * 60 * 60 * 1000 },
  privileged: { idleMs: 30 * 60 * 1000, absoluteMs: 8 * 60 * 60 * 1000 },
} as const satisfies Record<string, SessionPolicy>;

/** Roles that require MFA and receive the shorter session timeouts. */
export const PRIVILEGED_ROLES: readonly RoleKey[] = ["ADMIN", "MANAGER", "FINANCE"];

export function isPrivileged(roles: readonly RoleKey[]): boolean {
  return roles.some((role) => PRIVILEGED_ROLES.includes(role));
}

export function policyForRoles(roles: readonly RoleKey[]): SessionPolicy {
  return isPrivileged(roles) ? SESSION_POLICIES.privileged : SESSION_POLICIES.standard;
}

export interface SessionExpiry {
  idleExpiresAt: Date;
  expiresAt: Date;
}

export function computeSessionExpiry(
  now: Date,
  policy: SessionPolicy,
  absoluteAnchor: Date = now,
): SessionExpiry {
  return {
    idleExpiresAt: new Date(now.getTime() + policy.idleMs),
    expiresAt: new Date(absoluteAnchor.getTime() + policy.absoluteMs),
  };
}

/** A session is invalid once revoked, past its absolute deadline, or idle too long. */
export function isSessionActive(
  session: {
    revokedAt?: Date;
    idleExpiresAt: Date;
    expiresAt: Date;
  },
  now: Date,
): boolean {
  if (session.revokedAt) return false;
  if (now.getTime() >= session.expiresAt.getTime()) return false;
  if (now.getTime() >= session.idleExpiresAt.getTime()) return false;
  return true;
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
