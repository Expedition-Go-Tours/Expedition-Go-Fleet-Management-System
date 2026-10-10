import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { createTemplate, listTemplates } from "@/lib/repos/maintenance";

export const runtime = "nodejs";

/**
 * GET /api/v1/maintenance/templates
 * List reusable maintenance task templates (schedule:read).
 */
export async function GET() {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.SCHEDULE_READ);
    const templates = await listTemplates();
    return jsonOk({ templates });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/maintenance/templates
 * Create a task template (maintenance:template:manage).
 * Intervals are adjustable per policy — nothing is hardcoded for a vehicle.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.MAINTENANCE_TEMPLATE_MANAGE);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "GENERAL";
    const intervalKm = body.intervalKm === undefined ? undefined : Number(body.intervalKm);
    const intervalDays = body.intervalDays === undefined ? undefined : Number(body.intervalDays);

    if (!name || name.length > 200) throw ApiError.badRequest("Name is required (max 200 chars)");
    if (intervalKm !== undefined && (!Number.isFinite(intervalKm) || intervalKm <= 0)) {
      throw ApiError.badRequest("intervalKm must be a positive number");
    }
    if (intervalDays !== undefined && (!Number.isFinite(intervalDays) || intervalDays <= 0)) {
      throw ApiError.badRequest("intervalDays must be a positive number");
    }
    if (intervalKm === undefined && intervalDays === undefined) {
      throw ApiError.badRequest("At least one of intervalKm or intervalDays is required");
    }
    const dueSoonKm = body.dueSoonKm === undefined ? undefined : Number(body.dueSoonKm);
    const dueSoonDays = body.dueSoonDays === undefined ? undefined : Number(body.dueSoonDays);

    const template = await createTemplate({
      name,
      category,
      intervalKm,
      intervalDays,
      dueSoonKm,
      dueSoonDays,
      appliesToTypes: Array.isArray(body.appliesToTypes)
        ? body.appliesToTypes.filter((t): t is string => typeof t === "string").slice(0, 20)
        : undefined,
      source: typeof body.source === "string" ? body.source.slice(0, 300) : undefined,
      notes: typeof body.notes === "string" ? body.notes.slice(0, 1000) : undefined,
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.SCHEDULE_CREATED,
      actorId: context.user.id,
      entityType: "maintenanceTemplate",
      entityId: template.id,
      after: { name, intervalKm: intervalKm ?? null, intervalDays: intervalDays ?? null },
      requestId,
    });

    return jsonOk({ template }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
