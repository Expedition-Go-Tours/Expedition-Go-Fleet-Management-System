import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { wouldRemoveLastAdmin } from "@/lib/auth/invariants";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPublicUser } from "@/lib/auth/types";
import { getAdminAuth } from "@/lib/firebase/admin";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { revokeSessionsForUser } from "@/lib/repos/sessions";
import { getUserById, listUsers, setUserStatus } from "@/lib/repos/users";

export const runtime = "nodejs";

/**
 * POST /api/v1/users/[id]/disable
 * Disable a user account. Requires user:disable permission.
 * Enforces the last-active-administrator invariant (§6.5), disables the
 * Firebase Auth user, and revokes all sessions.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();

    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.USER_DISABLE);

    const { id } = await params;
    const target = await getUserById(id);
    if (!target) {
      throw ApiError.notFound("User not found");
    }
    if (target.id === context.user.id) {
      throw ApiError.forbidden("You cannot disable your own account");
    }

    const allUsers = await listUsers();
    if (wouldRemoveLastAdmin(allUsers, id)) {
      await writeAuditEvent({
        eventType: AUDIT_EVENTS.AUTHORIZATION_DENIED,
        actorId: context.user.id,
        entityType: "user",
        entityId: id,
        reason: "Attempted to disable the last active administrator",
        requestId,
        outcome: "FAILURE",
      });
      throw ApiError.conflict("Cannot disable the last active administrator");
    }

    const beforeStatus = target.status;
    await setUserStatus(id, "DISABLED");

    // Block sign-in at the Firebase layer too, then kill existing sessions.
    await getAdminAuth().updateUser(target.firebaseUid, { disabled: true });
    const revoked = await revokeSessionsForUser(id, "account disabled");

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.USER_STATUS_CHANGED,
      actorId: context.user.id,
      entityType: "user",
      entityId: id,
      before: { status: beforeStatus },
      after: { status: "DISABLED" },
      reason: revoked ? `revoked ${revoked} session(s)` : undefined,
      requestId,
    });

    return jsonOk({
      ok: true,
      revokedSessions: revoked,
      user: toPublicUser({ ...target, status: "DISABLED" }),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
