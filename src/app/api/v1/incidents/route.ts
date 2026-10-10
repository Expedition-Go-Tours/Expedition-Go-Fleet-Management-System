import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS, permissionsForRoles } from "@/lib/auth/permissions";
import { INCIDENT_SEVERITIES, INCIDENT_TYPES, type IncidentType } from "@/lib/domain/incident";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { createIncident, listIncidents } from "@/lib/repos/incidents";

export const runtime = "nodejs";

/**
 * GET /api/v1/incidents
 * Incident reports. incident:read:all sees everything; others see their own.
 * Requires at least one incident read permission — authentication alone is not
 * authorization. Query: ?vehicleId=&limit=
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    const perms = permissionsForRoles(context.user.roles);
    const canReadAll = perms.has(PERMISSIONS.INCIDENT_READ_ALL);
    if (!canReadAll && !perms.has(PERMISSIONS.INCIDENT_READ_OWN)) {
      throw ApiError.forbidden(`Missing permission: ${PERMISSIONS.INCIDENT_READ_OWN}`);
    }
    const vehicleId = request.nextUrl.searchParams.get("vehicleId") ?? undefined;
    const limitRaw = Number(request.nextUrl.searchParams.get("limit"));
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 100;
    const incidents = await listIncidents({
      vehicleId,
      reportedBy: canReadAll ? undefined : context.user.id,
      limit,
    });
    return jsonOk({ incidents });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/incidents
 * Report an incident (incident:create).
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.INCIDENT_CREATE);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId.trim() : "";
    if (!vehicleId) throw ApiError.badRequest("vehicleId is required");

    const typeRaw = typeof body.type === "string" ? body.type : "OTHER";
    if (!(INCIDENT_TYPES as readonly string[]).includes(typeRaw)) {
      throw ApiError.badRequest(`type must be one of: ${INCIDENT_TYPES.join(", ")}`);
    }
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (!description || description.length > 4000) {
      throw ApiError.badRequest("description is required (max 4000 chars)");
    }
    const severity = typeof body.severity === "string" ? body.severity : "MEDIUM";
    if (!(INCIDENT_SEVERITIES as readonly string[]).includes(severity)) {
      throw ApiError.badRequest(`severity must be one of: ${INCIDENT_SEVERITIES.join(", ")}`);
    }

    let occurredAt = new Date();
    if (body.occurredAt !== undefined) {
      const parsed = new Date(String(body.occurredAt));
      if (Number.isNaN(parsed.getTime()))
        throw ApiError.badRequest("occurredAt must be a valid date");
      if (parsed.getTime() > Date.now() + 60_000) {
        throw ApiError.badRequest("occurredAt cannot be in the future");
      }
      occurredAt = parsed;
    }

    const incident = await createIncident({
      vehicleId,
      type: typeRaw as IncidentType,
      occurredAt,
      location: typeof body.location === "string" ? body.location.trim() : undefined,
      description,
      severity,
      reportedByUserId: context.user.id,
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.INCIDENT_CREATED,
      actorId: context.user.id,
      entityType: "incident",
      entityId: incident.id,
      after: { vehicleId, type: incident.type, severity },
      requestId,
    });

    return jsonOk({ incident }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
