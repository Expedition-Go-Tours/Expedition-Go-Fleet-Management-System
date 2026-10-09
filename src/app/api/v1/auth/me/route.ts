import { randomUUID } from "node:crypto";

import { jsonOk, toErrorResponse } from "@/lib/api/errors";
import { requireAuthContext } from "@/lib/auth/guards";
import { permissionsForRoles } from "@/lib/auth/permissions";
import { toPublicUser } from "@/lib/auth/types";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";

// A GET route that reads cookies must never be prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/auth/me
 * Returns the current user, status, roles and effective permissions, or 401.
 */
export async function GET() {
  const requestId = randomUUID();
  try {
    const context = await requireAuthContext();
    return jsonOk({
      user: toPublicUser(context.user),
      permissions: [...permissionsForRoles(context.user.roles)],
    });
  } catch (error) {
    // Denials are audited so access problems are visible to operators.
    const status =
      error instanceof Error && "status" in error ? (error as { status: number }).status : 500;
    if (status === 403 || status === 401) {
      await writeAuditEvent({
        eventType: AUDIT_EVENTS.AUTHORIZATION_DENIED,
        requestId,
        outcome: "FAILURE",
      }).catch(() => {});
    }
    return toErrorResponse(error);
  }
}
