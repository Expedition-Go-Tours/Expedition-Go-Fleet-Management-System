import { randomUUID } from "node:crypto";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPublicUser } from "@/lib/auth/types";
import { getAdminAuth } from "@/lib/firebase/admin";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { getUserById, setUserStatus } from "@/lib/repos/users";

export const runtime = "nodejs";

/**
 * POST /api/v1/users/[id]/enable
 * Re-enable a previously disabled account. Requires user:disable permission
 * (account lifecycle management) and re-enables the Firebase Auth user.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    if (target.status !== "DISABLED") {
      throw ApiError.badRequest("User is not disabled");
    }

    await setUserStatus(id, "ACTIVE");
    await getAdminAuth().updateUser(target.firebaseUid, { disabled: false });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.USER_STATUS_CHANGED,
      actorId: context.user.id,
      entityType: "user",
      entityId: id,
      before: { status: "DISABLED" },
      after: { status: "ACTIVE" },
      requestId,
    });

    return jsonOk({ ok: true, user: toPublicUser({ ...target, status: "ACTIVE" }) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
