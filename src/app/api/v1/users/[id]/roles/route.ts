import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { wouldRemoveLastAdmin } from "@/lib/auth/invariants";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ROLE_KEYS, toPublicUser } from "@/lib/auth/types";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { getUserById, listUsers, setUserRoles } from "@/lib/repos/users";

export const runtime = "nodejs";

/**
 * POST /api/v1/users/[id]/roles
 * Assign roles to a user. Requires user:role:assign permission.
 * Enforces the "last active administrator" invariant (§6.5).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();

    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.USER_ROLE_ASSIGN);

    const { id } = await params;
    const body: unknown = await request.json().catch(() => null);
    const { roles } = body as { roles?: unknown };

    if (!Array.isArray(roles) || roles.length === 0) {
      throw ApiError.badRequest("At least one role is required");
    }
    if (!roles.every((r) => (ROLE_KEYS as readonly string[]).includes(r as string))) {
      throw ApiError.badRequest("Unknown role in roles array");
    }

    const target = await getUserById(id);
    if (!target) {
      throw ApiError.notFound("User not found");
    }

    // Enforce the last-active-administrator invariant.
    const allUsers = await listUsers();
    if (wouldRemoveLastAdmin(allUsers, id)) {
      await writeAuditEvent({
        eventType: AUDIT_EVENTS.AUTHORIZATION_DENIED,
        actorId: context.user.id,
        entityType: "user",
        entityId: id,
        reason: "Attempted to demote the last active administrator",
        requestId,
        outcome: "FAILURE",
      });
      throw ApiError.conflict("Cannot demote the last active administrator");
    }

    const beforeRoles = target.roles;
    const updated = await setUserRoles(
      id,
      roles as import("@/lib/auth/types").RoleKey[],
      context.user.id,
    );

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.USER_ROLE_ASSIGNED,
      actorId: context.user.id,
      entityType: "user",
      entityId: id,
      before: { roles: beforeRoles },
      after: { roles: updated.roles },
      requestId,
    });

    return jsonOk({ user: toPublicUser(updated) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
