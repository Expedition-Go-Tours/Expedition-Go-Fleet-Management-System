import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { clientAddress, enforceRateLimit, RATE_LIMITS } from "@/lib/api/rate-limit";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPublicUser } from "@/lib/auth/types";
import { getAdminAuth } from "@/lib/firebase/admin";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { getUserById, setUserMfaEnabled } from "@/lib/repos/users";

export const runtime = "nodejs";

/**
 * POST /api/v1/users/[id]/mfa/reset
 * Account recovery: clear every enrolled second factor so the person can sign
 * in again and set a new one.
 *
 * This is the supported recovery path when someone loses their authenticator
 * app. TOTP enrollment is client-side only (the Admin SDK can read and clear
 * factors but not create them), so a lost authenticator cannot be "re-issued" —
 * the factor must be removed and enrolled again.
 *
 * The action weakens an account, so it is deliberately loud: `user:update`
 * permission, a reason, and an audit record naming who did it and why. It may
 * be used on your own account — that is the common case (signed in on desktop,
 * phone gone) — and is audited the same way.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    enforceRateLimit(`invite:${clientAddress(request)}`, RATE_LIMITS.invite);
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.USER_UPDATE);

    const { id } = await params;
    const target = await getUserById(id);
    if (!target) throw ApiError.notFound("User not found");

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason || reason.length > 500) {
      throw ApiError.badRequest(
        "Resetting two-factor authentication requires a reason (max 500 chars)",
      );
    }

    const account = await getAdminAuth().getUser(target.firebaseUid);
    const factorCount = account.multiFactor?.enrolledFactors?.length ?? 0;
    if (factorCount === 0) {
      throw ApiError.conflict("This account has no second factor enrolled");
    }

    await getAdminAuth().updateUser(target.firebaseUid, { multiFactor: { enrolledFactors: [] } });
    await setUserMfaEnabled(target.id, false);

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.MFA_REMOVED,
      actorId: context.user.id,
      entityType: "user",
      entityId: target.id,
      before: { mfaEnabled: true, factorCount },
      after: { mfaEnabled: false },
      reason,
      requestId,
    });

    const refreshed = await getUserById(target.id);
    return jsonOk({
      user: toPublicUser(refreshed ?? target),
      factorsRemoved: factorCount,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
