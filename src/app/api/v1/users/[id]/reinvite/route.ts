import { randomUUID } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { generateTempPassword } from "@/lib/auth/passwords";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPublicUser } from "@/lib/auth/types";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { getUserById } from "@/lib/repos/users";

export const runtime = "nodejs";

/**
 * POST /api/v1/users/[id]/reinvite
 * Issue a fresh temporary password for a user still in INVITED state (the
 * original was lost or never delivered). Requires user:invite permission.
 * The new temp password is returned once.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();

    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.USER_INVITE);

    const { id } = await params;
    const target = await getUserById(id);
    if (!target) {
      throw ApiError.notFound("User not found");
    }
    if (target.status !== "INVITED") {
      throw ApiError.badRequest("Only INVITED users can be re-invited");
    }

    const tempPassword = generateTempPassword();

    await getAdminAuth().updateUser(target.firebaseUid, { password: tempPassword });
    await getAdminDb()
      .collection(COLLECTIONS.users)
      .doc(id)
      .update({ mustChangePassword: true, updatedAt: FieldValue.serverTimestamp() });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.INVITE_CREATED,
      actorId: context.user.id,
      entityType: "user",
      entityId: id,
      after: { reinvited: true, email: target.email },
      requestId,
    });

    return jsonOk({
      user: toPublicUser({ ...target, status: "INVITED", mustChangePassword: true }),
      tempPassword,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
