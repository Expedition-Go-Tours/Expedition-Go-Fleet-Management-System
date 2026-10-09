import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";

import { jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, getAuthContext, secureCookies } from "@/lib/auth/guards";
import {
  csrfCookieName,
  csrfCookieOptions,
  hashSessionToken,
  sessionCookieName,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { serverEnv } from "@/lib/env";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { revokeSession } from "@/lib/repos/sessions";

/**
 * POST /api/v1/auth/logout
 * Destroys the current session and clears the session + CSRF cookies.
 */
export async function POST() {
  const requestId = randomUUID();
  try {
    // State-changing: require CSRF + origin. A logout with an invalid session
    // still clears cookies, so tolerate failures below.
    await assertCsrfAndOrigin();

    const cookieStore = await cookies();
    const secure = secureCookies();
    const rawToken = cookieStore.get(sessionCookieName(secure))?.value;

    let actorId: string | undefined;
    if (rawToken) {
      const tokenHash = hashSessionToken(rawToken, serverEnv.sessionSecret);
      const context = await getAuthContext().catch(() => null);
      actorId = context?.user.id;
      await revokeSession(tokenHash, "user logout").catch(() => {});
      await writeAuditEvent({
        eventType: AUDIT_EVENTS.LOGOUT,
        actorId,
        requestId,
      });
      await writeAuditEvent({
        eventType: AUDIT_EVENTS.SESSION_REVOKED,
        actorId,
        requestId,
      });
    }

    cookieStore.set(sessionCookieName(secure), "", sessionCookieOptions(0, secure));
    cookieStore.set(csrfCookieName(secure), "", csrfCookieOptions(secure, 0));

    return jsonOk({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
