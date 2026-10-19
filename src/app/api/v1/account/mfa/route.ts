import { randomUUID } from "node:crypto";

import { jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext } from "@/lib/auth/guards";
import { isPrivileged } from "@/lib/auth/session";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { getAdminAuth } from "@/lib/firebase/admin";
import { setMfaEnrollmentRequired } from "@/lib/repos/sessions";
import { setUserMfaEnabled } from "@/lib/repos/users";

export const runtime = "nodejs";

/**
 * POST /api/v1/account/mfa
 * Re-read the account's second-factor enrollment from Firebase and sync it onto
 * our user record and the current session.
 *
 * Enrollment itself happens in the browser against Firebase — the TOTP secret
 * never touches our database. This endpoint only records the outcome, so the
 * server knows whether the account is protected and can lift (or reinstate) the
 * enrollment-only session restriction.
 *
 * Deliberately NOT permission-gated: a session that exists solely to enroll a
 * second factor must be able to reach it. `requireAuthContext` still applies,
 * and CSRF + origin checks cover the write.
 */
export async function POST() {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();

    const record = await getAdminAuth().getUser(context.user.firebaseUid);
    const enrolledFactors = record.multiFactor?.enrolledFactors ?? [];
    const mfaEnabled = enrolledFactors.length > 0;

    // Removing their only factor puts a privileged user back into the
    // enrollment-only state — they must never be left running unprotected.
    const needsEnrollment = !mfaEnabled && isPrivileged(context.user.roles);

    await setUserMfaEnabled(context.user.id, mfaEnabled);
    await setMfaEnrollmentRequired(context.session.tokenHash, needsEnrollment);

    if (Boolean(context.user.mfaEnabled) !== mfaEnabled) {
      await writeAuditEvent({
        eventType: mfaEnabled ? AUDIT_EVENTS.MFA_ENROLLED : AUDIT_EVENTS.MFA_REMOVED,
        actorId: context.user.id,
        entityType: "user",
        entityId: context.user.id,
        reason: `${enrolledFactors.length} second factor(s) enrolled`,
        requestId,
      });
    }

    return jsonOk({
      mfaEnabled,
      factorCount: enrolledFactors.length,
      mfaEnrollmentRequired: needsEnrollment,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
