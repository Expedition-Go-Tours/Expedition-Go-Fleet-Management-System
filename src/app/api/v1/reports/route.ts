import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS, rolesHavePermission } from "@/lib/auth/permissions";
import {
  ISSUE_CATEGORIES,
  REPORT_SEVERITIES,
  type IssueCategory,
  type ReportSeverity,
} from "@/lib/domain/report";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { createIssue, listIssues } from "@/lib/repos/reports";
import { applyVehicleStatus, getVehicleById } from "@/lib/repos/vehicles";

export const runtime = "nodejs";

/**
 * GET /api/v1/reports
 * List vehicle issues.
 *  - report:read:all → every issue
 *  - otherwise report:read:own → only the caller's issues
 * Query: ?vehicleId=&status=&severity=&limit=
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

    const issues = await listIssues({
      reportedBy: canReadAll ? undefined : context.user.id,
      vehicleId: params.get("vehicleId") ?? undefined,
      status: (statusParam as "OPEN" | "TRIAGED" | "CLOSED" | null) ?? undefined,
      severity: params.get("severity") ?? undefined,
      limit,
    });
    return jsonOk({ reports: issues });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/reports
 * Report a vehicle problem (driver/ops/maintenance per report:create).
 *
 * `reportedBy` is ALWAYS the authenticated user — never browser-supplied.
 * A critical safety issue automatically places the vehicle on safety hold
 * (server-side, audited); the driver cannot bypass or undo it.
 * `clientToken` makes retried submissions idempotent.
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
    const severity = typeof body.severity === "string" ? body.severity : "MEDIUM";
    const category = typeof body.category === "string" ? body.category : undefined;
    const safetyCritical = body.safetyCritical === true || severity === "CRITICAL";
    const immobilized = body.immobilized === true;
    const odometerKm =
      typeof body.odometerKm === "number" && Number.isSafeInteger(body.odometerKm)
        ? body.odometerKm
        : undefined;
    const clientToken =
      typeof body.clientToken === "string" && body.clientToken.length > 0
        ? body.clientToken.slice(0, 100)
        : undefined;

    if (!vehicleId) throw ApiError.badRequest("vehicleId is required");
    if (!title || title.length > 200)
      throw ApiError.badRequest("Title is required (max 200 chars)");
    if (!description || description.length > 5000) {
      throw ApiError.badRequest("Description is required (max 5000 chars)");
    }
    if (!(REPORT_SEVERITIES as readonly string[]).includes(severity)) {
      throw ApiError.badRequest(`Severity must be one of: ${REPORT_SEVERITIES.join(", ")}`);
    }
    if (category && !(ISSUE_CATEGORIES as readonly string[]).includes(category)) {
      throw ApiError.badRequest(`Category must be one of: ${ISSUE_CATEGORIES.join(", ")}`);
    }

    const vehicle = await getVehicleById(vehicleId);
    if (!vehicle) throw ApiError.badRequest("Unknown vehicleId");
    if (vehicle.status === "ARCHIVED") {
      throw ApiError.conflict("Cannot report on an archived vehicle");
    }

    const issue = await createIssue({
      vehicleId,
      reportedBy: context.user.id,
      title,
      description,
      severity: severity as ReportSeverity,
      category: category as IssueCategory | undefined,
      safetyCritical,
      affectsSafeOperation: body.affectsSafeOperation === true || safetyCritical,
      immobilized,
      odometerKm,
      assignmentId: typeof body.assignmentId === "string" ? body.assignmentId : undefined,
      location: typeof body.location === "string" ? body.location.slice(0, 300) : undefined,
      immediateAction:
        typeof body.immediateAction === "string" ? body.immediateAction.slice(0, 1000) : undefined,
      clientToken,
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.REPORT_CREATED,
      actorId: context.user.id,
      entityType: "issue",
      entityId: issue.id,
      after: {
        vehicleId,
        severity,
        category: category ?? null,
        safetyCritical,
        immobilized,
        number: issue.number,
      },
      requestId,
    });

    // Stage 2 — safety assessment: a critical or immobilizing defect
    // restricts the vehicle immediately, server-side.
    let safetyHoldApplied = false;
    if ((safetyCritical || immobilized) && vehicle.status !== "SAFETY_HOLD") {
      await applyVehicleStatus(vehicleId, "SAFETY_HOLD", {
        safetyHoldReason: immobilized
          ? `Vehicle immobilized — ${issue.number ?? issue.id}`
          : `Critical safety issue ${issue.number ?? issue.id}`,
        actorId: context.user.id,
        issueId: issue.id,
      });
      safetyHoldApplied = true;
      await writeAuditEvent({
        eventType: AUDIT_EVENTS.SAFETY_HOLD_APPLIED,
        actorId: context.user.id,
        entityType: "vehicle",
        entityId: vehicleId,
        reason: `automatic hold from issue ${issue.number ?? issue.id}`,
        requestId,
      });
    }

    return jsonOk({ report: issue, safetyHoldApplied }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
