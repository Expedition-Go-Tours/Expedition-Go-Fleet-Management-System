import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { updateTemplate } from "@/lib/repos/maintenance";

export const runtime = "nodejs";

/**
 * PATCH /api/v1/maintenance/templates/[id]
 * Update a template (maintenance:template:manage).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.MAINTENANCE_TEMPLATE_MANAGE);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const fields: Parameters<typeof updateTemplate>[1] = {};
    if (body.name !== undefined) {
      const value = typeof body.name === "string" ? body.name.trim() : "";
      if (!value || value.length > 200) throw ApiError.badRequest("Invalid name");
      fields.name = value;
    }
    if (body.intervalKm !== undefined) fields.intervalKm = Number(body.intervalKm);
    if (body.intervalDays !== undefined) fields.intervalDays = Number(body.intervalDays);
    if (body.dueSoonKm !== undefined) fields.dueSoonKm = Number(body.dueSoonKm);
    if (body.dueSoonDays !== undefined) fields.dueSoonDays = Number(body.dueSoonDays);
    if (body.source !== undefined && typeof body.source === "string") {
      fields.source = body.source.slice(0, 300);
    }
    if (body.enabled !== undefined) fields.enabled = body.enabled === true;

    if (Object.keys(fields).length === 0) throw ApiError.badRequest("No updatable fields");
    const template = await updateTemplate(id, fields);

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.SCHEDULE_UPDATED,
      actorId: context.user.id,
      entityType: "maintenanceTemplate",
      entityId: id,
      after: fields,
      requestId,
    });

    return jsonOk({ template });
  } catch (error) {
    return toErrorResponse(error);
  }
}
