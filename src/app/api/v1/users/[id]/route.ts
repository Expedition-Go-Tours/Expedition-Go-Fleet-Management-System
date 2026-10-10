import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { requireString } from "@/lib/api/validate";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPublicUser } from "@/lib/auth/types";
import { getAdminAuth } from "@/lib/firebase/admin";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { getUserById, updateUserProfile } from "@/lib/repos/users";

export const runtime = "nodejs";

/**
 * PATCH /api/v1/users/[id]
 * Correct an employee's profile (name / phone) on their behalf.
 *
 * Requires user:update (baseline: ADMIN only). Deliberately narrow:
 *   • roles change through /roles (last-administrator invariant),
 *   • status changes through /enable and /disable (session revocation),
 *   • email is never editable — it is the Firebase Auth identity key.
 * Every change is written to the audit log with before/after values.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();

    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.USER_UPDATE);

    const { id } = await params;
    const body: unknown = await request.json().catch(() => null);
    if (typeof body !== "object" || body === null) {
      throw ApiError.badRequest("Request body must be an object");
    }
    const record = body as Record<string, unknown>;

    const hasName = record.name !== undefined;
    const hasPhone = record.phone !== undefined;
    if (!hasName && !hasPhone) {
      throw ApiError.badRequest("Nothing to update — provide name and/or phone");
    }

    const name = hasName ? requireString(record.name, "Name", { max: 200 }) : undefined;
    const phone = hasPhone
      ? record.phone === null || record.phone === ""
        ? null
        : requireString(record.phone, "Phone", { max: 50 })
      : undefined;

    const target = await getUserById(id);
    if (!target) throw ApiError.notFound("User not found");

    const updated = await updateUserProfile(id, { name, phone });

    // Keep the Firebase Auth display name in step with the profile. Best-effort:
    // a Firebase outage must not roll back the record we just wrote.
    if (name !== undefined && target.firebaseUid) {
      await getAdminAuth()
        .updateUser(target.firebaseUid, { displayName: name })
        .catch((error) => console.warn("[users] display name sync failed", error));
    }

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.USER_UPDATED,
      actorId: context.user.id,
      entityType: "user",
      entityId: id,
      before: { name: target.name, phone: target.phone ?? null },
      after: { name: updated.name, phone: updated.phone ?? null },
      requestId,
    });

    return jsonOk({ user: toPublicUser(updated) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
