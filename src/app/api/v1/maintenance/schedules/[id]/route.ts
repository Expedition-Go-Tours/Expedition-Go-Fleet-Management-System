import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { getScheduleById, updateSchedule } from "@/lib/repos/maintenance";

export const runtime = "nodejs";

/**
 * PATCH /api/v1/maintenance/schedules/[id]
 * Adjust intervals/thresholds/enabled (schedule:manage). Baselines are NOT
 * editable here — they move only through recorded service completion.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.SCHEDULE_MANAGE);

    const { id } = await params;
    const schedule = await getScheduleById(id);
    if (!schedule) throw ApiError.notFound("Schedule not found");

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");
    if ("lastServiceOdometerKm" in body || "lastServiceDate" in body) {
      throw ApiError.badRequest(
        "Baselines cannot be edited directly — record a completed service instead",
      );
    }

    const fields: Parameters<typeof updateSchedule>[1] = {};
    if (body.intervalKm !== undefined) fields.intervalKm = Number(body.intervalKm);
    if (body.intervalDays !== undefined) fields.intervalDays = Number(body.intervalDays);
    if (body.dueSoonKm !== undefined) fields.dueSoonKm = Number(body.dueSoonKm);
    if (body.dueSoonDays !== undefined) fields.dueSoonDays = Number(body.dueSoonDays);
    if (body.enabled !== undefined) fields.enabled = body.enabled === true;
    if (body.source !== undefined && typeof body.source === "string") {
      fields.source = body.source.slice(0, 300);
    }
    if (body.notes !== undefined && typeof body.notes === "string") {
      fields.notes = body.notes.slice(0, 1000);
    }
    if (Object.keys(fields).length === 0) throw ApiError.badRequest("No updatable fields");

    const updated = await updateSchedule(id, fields);
    await writeAuditEvent({
      eventType: AUDIT_EVENTS.SCHEDULE_UPDATED,
      actorId: context.user.id,
      entityType: "maintenanceSchedule",
      entityId: id,
      after: fields,
      requestId,
    });
    return jsonOk({ schedule: updated });
  } catch (error) {
    return toErrorResponse(error);
  }
}
