import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS, rolesHavePermission } from "@/lib/auth/permissions";
import { REPORT_SEVERITIES, type ReportStatus } from "@/lib/domain/report";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { createReport, listReports } from "@/lib/repos/reports";
import { getVehicleById } from "@/lib/repos/vehicles";

export const runtime = "nodejs";

/**
 * GET /api/v1/reports
 * List maintenance reports.
 *  - report:read:all → every report (operations/maintenance/manager/finance)
 *  - otherwise report:read:own → only the caller's reports (driver)
 * Query filters: ?vehicleId=&status=&limit=
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    const canReadAll = rolesHavePermission(context.user.roles, PERMISSIONS.REPORT_READ_ALL);
    if (!canReadAll && !rolesHavePermission(context.user.roles, PERMISSIONS.REPORT_READ_OWN)) {
      throw ApiError.forbidden("Missing permission: report:read:own");
    }

    const params = request.nextUrl.searchParams;
    const limitRaw = Number(params.get("limit"));
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 500 ? limitRaw : 100;
    const statusParam = params.get("status");
    if (statusParam && !["OPEN", "TRIAGED", "CLOSED"].includes(statusParam)) {
      throw ApiError.badRequest("status must be OPEN, TRIAGED or CLOSED");
    }

    const reports = await listReports({
      // Own-ness scoping applies only when the user lacks report:read:all.
      scopeUserId: canReadAll ? undefined : context.user.id,
      vehicleId: params.get("vehicleId") ?? undefined,
      status: (statusParam as ReportStatus | null) ?? undefined,
      limit,
    });
    return jsonOk({ reports });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/reports
 * Raise a maintenance report (typically a driver reporting a fault).
 * Requires report:create. The vehicle must exist.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.REPORT_CREATE);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const severity = typeof body.severity === "string" ? body.severity : "";

    if (!vehicleId) throw ApiError.badRequest("vehicleId is required");
    if (!title || title.length > 200)
      throw ApiError.badRequest("Title is required (max 200 chars)");
    if (!description || description.length > 5000) {
      throw ApiError.badRequest("Description is required (max 5000 chars)");
    }
    if (!(REPORT_SEVERITIES as readonly string[]).includes(severity)) {
      throw ApiError.badRequest(`Severity must be one of: ${REPORT_SEVERITIES.join(", ")}`);
    }

    const vehicle = await getVehicleById(vehicleId);
    if (!vehicle) throw ApiError.badRequest("Unknown vehicleId");
    if (vehicle.status === "ARCHIVED") {
      throw ApiError.conflict("Cannot report on an archived vehicle");
    }

    const report = await createReport({
      vehicleId,
      reportedBy: context.user.id,
      title,
      description,
      severity: severity as import("@/lib/domain/report").ReportSeverity,
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.REPORT_CREATED,
      actorId: context.user.id,
      entityType: "report",
      entityId: report.id,
      after: { vehicleId, severity, title },
      requestId,
    });

    return jsonOk({ report }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
