import { cookies, headers } from "next/headers";

import { ApiError } from "@/lib/api/errors";
import { isTrustedOrigin, verifyCsrf } from "@/lib/auth/csrf";
import {
  CSRF_HEADER,
  csrfCookieName,
  hashSessionToken,
  isPrivileged,
  isSessionActive,
  policyForRoles,
  sessionCookieName,
} from "@/lib/auth/session";
import { rolesHavePermission, type PermissionKey } from "@/lib/auth/permissions";
import type { AuthContext } from "@/lib/auth/types";
import { serverEnv } from "@/lib/env";
import { getSession, touchSession } from "@/lib/repos/sessions";
import { getUserById } from "@/lib/repos/users";

/**
 * Server-side guard layer (AUTHENTICATION_AUTHORIZATION.md §9).
 *
 *   requireAuthContext() → requirePermission("permission:key") → authorizeResource(...)
 *
 * Every protected request validates the session and reloads the user with no
 * caching, so suspension/disablement/revocation take effect on the next request.
 */

export function secureCookies(): boolean {
  return process.env.NODE_ENV === "production" || serverEnv.appUrl.startsWith("https://");
}

/** Load and validate the current session + active user, or null. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const store = await cookies();
  const rawToken = store.get(sessionCookieName(secureCookies()))?.value;
  if (!rawToken) return null;

  const tokenHash = hashSessionToken(rawToken, serverEnv.sessionSecret);
  const session = await getSession(tokenHash);
  if (!session) return null;

  const now = new Date();
  if (!isSessionActive(session, now)) return null;

  const user = await getUserById(session.userId);
  if (!user) return null;

  // Allow INVITED users only if they have a mustChangePassword session (temp-password onboarding).
  const pendingPasswordChange = session.mustChangePassword === true;
  if (user.status !== "ACTIVE" && !(user.status === "INVITED" && pendingPasswordChange)) {
    return null;
  }

  // Sliding idle window, capped by the absolute deadline. Fail closed: if the
  // session store cannot be updated, reject rather than extend silently.
  const policy = policyForRoles(user.roles);
  const idleExpiresAt = new Date(
    Math.min(now.getTime() + policy.idleMs, session.expiresAt.getTime()),
  );
  if (idleExpiresAt.getTime() > session.idleExpiresAt.getTime()) {
    await touchSession(tokenHash, now, idleExpiresAt);
  }

  return {
    user,
    session: { ...session, lastSeenAt: now, idleExpiresAt },
    isPrivileged: isPrivileged(user.roles),
  };
}

/** Like getAuthContext but throws 401 when there is no valid session. */
export async function requireAuthContext(): Promise<AuthContext> {
  const context = await getAuthContext();
  if (!context) throw ApiError.unauthorized();
  return context;
}

/** Throw 403 unless the current user holds the permission. */
export function requirePermission(context: AuthContext, permission: PermissionKey): void {
  // Sessions awaiting password change are restricted to /auth/password only.
  if (context.session.mustChangePassword) {
    throw ApiError.forbidden(
      "You must change your temporary password before continuing",
      "PASSWORD_CHANGE_REQUIRED",
    );
  }
  if (!rolesHavePermission(context.user.roles, permission)) {
    throw ApiError.forbidden(`Missing permission: ${permission}`);
  }
}

/**
 * CSRF + Origin validation for state-changing requests (login bootstrap is the
 * exception — it is protected by Origin checking alone).
 */
export async function assertCsrfAndOrigin(): Promise<void> {
  const headerStore = await headers();
  const origin = headerStore.get("origin");
  if (!isTrustedOrigin(origin, serverEnv.appUrl)) {
    throw ApiError.forbidden("Untrusted origin");
  }

  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(csrfCookieName(secureCookies()))?.value ?? null;
  const headerToken = headerStore.get(CSRF_HEADER);
  if (!verifyCsrf(headerToken, cookieToken)) {
    throw ApiError.forbidden("Invalid CSRF token");
  }
}
