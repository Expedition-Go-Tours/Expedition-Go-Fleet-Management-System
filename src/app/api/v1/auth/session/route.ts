import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { generateCsrfToken, isTrustedOrigin } from "@/lib/auth/csrf";
import { secureCookies } from "@/lib/auth/guards";
import { permissionsForRoles } from "@/lib/auth/permissions";
import {
  computeSessionExpiry,
  csrfCookieName,
  csrfCookieOptions,
  generateSessionToken,
  hashSessionToken,
  isPrivileged,
  policyForRoles,
  sessionCookieName,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { toPublicUser } from "@/lib/auth/types";
import { serverEnv } from "@/lib/env";
import { getAdminAuth } from "@/lib/firebase/admin";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { createSession } from "@/lib/repos/sessions";
import { activateUser, getUserByFirebaseUid, touchLastLogin } from "@/lib/repos/users";

/** How old a Firebase ID token's auth_time may be for session establishment. */
const MAX_AUTH_AGE_SECONDS = 5 * 60;

/**
 * POST /api/v1/auth/session
 * Exchanges a short-lived Firebase ID token for an opaque application session.
 *
 * The browser signs in via the Firebase client SDK, then posts the ID token
 * here. On success the session token is set in an HttpOnly cookie and the
 * client discards its Firebase auth state.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    const origin = request.headers.get("origin");
    if (origin && !isTrustedOrigin(origin, serverEnv.appUrl)) {
      throw ApiError.forbidden("Untrusted origin");
    }

    const body: unknown = await request.json().catch(() => null);
    const idToken = (body as { idToken?: unknown } | null)?.idToken;
    if (typeof idToken !== "string" || idToken.length === 0) {
      throw ApiError.badRequest("Missing ID token");
    }

    const decoded = await getAdminAuth()
      .verifyIdToken(idToken, true)
      .catch(() => null);
    if (!decoded) {
      await writeAuditEvent({
        eventType: AUDIT_EVENTS.SIGN_IN_FAILED,
        requestId,
        outcome: "FAILURE",
      });
      throw ApiError.unauthorized("Invalid or expired token");
    }

    // Sessions must be minted from a recent authentication.
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (nowSeconds - decoded.auth_time > MAX_AUTH_AGE_SECONDS) {
      throw ApiError.unauthorized("Token is not recent; please sign in again");
    }

    const user = await getUserByFirebaseUid(decoded.uid);
    if (!user) {
      await writeAuditEvent({
        eventType: AUDIT_EVENTS.SIGN_IN_FAILED,
        requestId,
        outcome: "FAILURE",
      });
      throw ApiError.forbidden("No account exists for this user");
    }
    if (user.status === "SUSPENDED" || user.status === "DISABLED") {
      await writeAuditEvent({
        eventType: AUDIT_EVENTS.SIGN_IN_FAILED,
        actorId: user.id,
        requestId,
        outcome: "FAILURE",
      });
      throw ApiError.forbidden("This account is not active");
    }

    // First sign-in by an invited user activates the account (invite acceptance).
    if (user.status === "INVITED") {
      await activateUser(user.id);
      await writeAuditEvent({
        eventType: AUDIT_EVENTS.INVITE_ACCEPTED,
        actorId: user.id,
        entityType: "user",
        entityId: user.id,
        requestId,
      });
      user.status = "ACTIVE";
    }

    // MFA policy: privileged roles cannot establish a session without MFA.
    const privileged = isPrivileged(user.roles);
    const secondFactor = (
      decoded as {
        firebase?: { sign_in_second_factor?: string };
      }
    ).firebase?.sign_in_second_factor;
    const mfaSatisfied = typeof secondFactor === "string" && secondFactor.length > 0;
    if (privileged && !mfaSatisfied) {
      throw ApiError.forbidden("Multi-factor authentication is required", "MFA_REQUIRED");
    }

    // Mint the opaque session.
    const secure = secureCookies();
    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken, serverEnv.sessionSecret);
    const now = new Date();
    const policy = policyForRoles(user.roles);
    const expiry = computeSessionExpiry(now, policy);

    await createSession({
      tokenHash,
      userId: user.id,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: expiry.idleExpiresAt,
      expiresAt: expiry.expiresAt,
      mfaSatisfied,
      userAgentLabel: coarseUserAgent(request.headers.get("user-agent")),
    });

    const csrfToken = generateCsrfToken();
    const maxAgeSeconds = Math.floor(policy.absoluteMs / 1000);
    const cookieStore = await cookies();
    cookieStore.set(
      sessionCookieName(secure),
      sessionToken,
      sessionCookieOptions(maxAgeSeconds, secure),
    );
    cookieStore.set(csrfCookieName(secure), csrfToken, csrfCookieOptions(secure, maxAgeSeconds));

    await touchLastLogin(user.id);
    await writeAuditEvent({
      eventType: AUDIT_EVENTS.SIGN_IN_SUCCEEDED,
      actorId: user.id,
      requestId,
    });
    await writeAuditEvent({
      eventType: AUDIT_EVENTS.SESSION_CREATED,
      actorId: user.id,
      requestId,
    });

    return jsonOk({
      user: toPublicUser(user),
      permissions: [...permissionsForRoles(user.roles)],
      csrfToken,
      expiresAt: expiry.expiresAt.toISOString(),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** A coarse "label" for the session registry — never the full user agent. */
function coarseUserAgent(ua: string | null): string {
  if (!ua) return "unknown";
  if (/iPhone|iPad/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Macintosh/.test(ua)) return "mac";
  if (/Windows/.test(ua)) return "windows";
  if (/Linux/.test(ua)) return "linux";
  return "other";
}
