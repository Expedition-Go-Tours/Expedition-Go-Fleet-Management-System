import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS, permissionsForRoles } from "@/lib/auth/permissions";
import { getIncidentById } from "@/lib/repos/incidents";

export const runtime = "nodejs";

/**
 * GET /api/v1/incidents/[id]
 * Single incident — the reporter or anyone with incident:read:all. Requires an
 * incident read permission before the row is even loaded.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAuthContext();
    const perms = permissionsForRoles(context.user.roles);
    const canReadAll = perms.has(PERMISSIONS.INCIDENT_READ_ALL);
    if (!canReadAll && !perms.has(PERMISSIONS.INCIDENT_READ_OWN)) {
      throw ApiError.forbidden(`Missing permission: ${PERMISSIONS.INCIDENT_READ_OWN}`);
    }
    const { id } = await params;
    const incident = await getIncidentById(id);
    if (!incident) {
      return jsonOk({ incident: null });
    }
    if (!canReadAll && incident.reportedByUserId !== context.user.id) {
      return jsonOk({ incident: null });
    }
    return jsonOk({ incident });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.INCIDENT_MANAGE);
    // Manage endpoint — only safe editable fields, everything else via status actions.
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const { id } = await params;
    const incident = await getIncidentById(id);
    if (!incident) {
      return jsonOk({ incident: null });
    }
    const { location, description, severity } = body ?? {};
    const update: { location?: string; description?: string; severity?: string } = {};
    if (typeof location === "string") update.location = location.trim();
    if (typeof description === "string" && description.trim()) {
      update.description = description.trim().slice(0, 4000);
    }
    if (typeof severity === "string") update.severity = severity;
    if (Object.keys(update).length > 0) {
      // Persist via repo (audit policy: status changes are the audited ones).
      const { getAdminDb } = await import("@/lib/firebase/admin");
      const { COLLECTIONS } = await import("@/lib/db/collections");
      await getAdminDb()
        .collection(COLLECTIONS.incidentReports)
        .doc(id)
        .update({ ...update, updatedAt: new Date() });
    }
    const updated = await getIncidentById(id);
    return jsonOk({ incident: updated });
  } catch (error) {
    return toErrorResponse(error);
  }
}
