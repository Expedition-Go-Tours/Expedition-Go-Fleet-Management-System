import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext } from "@/lib/auth/guards";
import { validatePassword } from "@/lib/auth/passwords";
import { toPublicUser } from "@/lib/auth/types";
import { getAdminAuth } from "@/lib/firebase/admin";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { revokeSessionsForUser } from "@/lib/repos/sessions";
import { activateUser } from "@/lib/repos/users";

export const runtime = "nodejs";

/**
 * POST /api/v1/auth/password
 * Change the current user's password. Used for:
 *  - First-time password setup for invited users (temporary password → real one)
 *  - Voluntary password changes by active users
 *
 * Body: { currentPassword, newPassword }
 *
 * The current password is proven against Firebase Identity Toolkit before the
 * change is applied. On success every session for the user is revoked (including
 * the caller's) and the response asks the client to re-authenticate — this
 * preserves the MFA-at-session-establishment policy for privileged roles
 * instead of re-minting a session without a second-factor check.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();

    const context = await requireAuthContext();
    const { user } = context;

    const body: unknown = await request.json().catch(() => null);
    const currentPassword = (body as { currentPassword?: unknown } | null)?.currentPassword;
    const newPassword = (body as { newPassword?: unknown } | null)?.newPassword;

    if (typeof currentPassword !== "string" || currentPassword.length === 0) {
      throw ApiError.badRequest("Current password is required");
    }
    if (typeof newPassword !== "string" || newPassword.length === 0) {
      throw ApiError.badRequest("New password is required");
    }
    if (currentPassword === newPassword) {
      throw ApiError.badRequest("New password must differ from the current password");
    }

    const validation = validatePassword(newPassword);
    if (!validation.ok) {
      throw ApiError.badRequest(validation.errors.join("; "));
    }

    // Prove knowledge of the current password via Firebase Identity Toolkit.
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!apiKey) {
      throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is not configured");
    }

    const signInRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          password: currentPassword,
          returnSecureToken: true,
        }),
      },
    );

    const signInData = (await signInRes.json()) as {
      idToken?: string;
      mfaPendingCredential?: string;
      error?: { code?: number | string; message?: string };
    };

    // Password accepted if Identity Toolkit issued a token, returned a pending
    // MFA credential (password validated, second factor still outstanding), or
    // signalled a second-factor requirement. Anything else → wrong password.
    // Identity Toolkit reports { code: 400, message: "INVALID_PASSWORD" } — the
    // reason lives in `message`, and `code` may be a number.
    const message = signInData.error?.message ?? "";
    const mfaChallenge =
      message.includes("MFA") ||
      message.includes("SECOND_FACTOR") ||
      typeof signInData.mfaPendingCredential === "string";
    const passwordAccepted = Boolean(signInData.idToken) || mfaChallenge;

    if (!passwordAccepted) {
      await writeAuditEvent({
        eventType: AUDIT_EVENTS.SIGN_IN_FAILED,
        actorId: user.id,
        reason: "password change: current password incorrect",
        requestId,
        outcome: "FAILURE",
      });
      throw ApiError.forbidden("Current password is incorrect", "INVALID_CREDENTIALS");
    }

    // Apply the new password.
    await getAdminAuth().updateUser(user.firebaseUid, { password: newPassword });

    const wasOnboarding = user.status === "INVITED" || Boolean(user.mustChangePassword);
    if (wasOnboarding) {
      await activateUser(user.id);
      await writeAuditEvent({
        eventType: AUDIT_EVENTS.INVITE_ACCEPTED,
        actorId: user.id,
        entityType: "user",
        entityId: user.id,
        requestId,
      });
    }

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.PASSWORD_CHANGED,
      actorId: user.id,
      requestId,
    });

    // Credential change → revoke every session (including this one). The client
    // signs in again, which re-runs the MFA policy at session establishment.
    await revokeSessionsForUser(user.id, "password changed");

    return jsonOk({
      ok: true,
      mustReauthenticate: true,
      user: toPublicUser({ ...user, status: "ACTIVE", mustChangePassword: false }),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
