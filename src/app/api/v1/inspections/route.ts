import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  INSPECTION_RESULTS,
  defaultChecklist,
  overallResult,
  type InspectionItem,
  type InspectionResult,
} from "@/lib/domain/inspection";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { submitInspection, listInspections } from "@/lib/repos/inspections";
import { createIssue } from "@/lib/repos/reports";
import { applyVehicleStatus, getVehicleById } from "@/lib/repos/vehicles";
import { recordReading } from "@/lib/repos/odometers";
import { getActiveAssignmentForDriver } from "@/lib/repos/assignments";

export const runtime = "nodejs";

/**
 * GET /api/v1/inspections
 * List inspections (inspection:read). Drivers see their own unless they
 * hold broader read. Query: ?vehicleId=&limit=
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.INSPECTION_READ);

    const params = request.nextUrl.searchParams;
    const limitRaw = Number(params.get("limit"));
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 500 ? limitRaw : 50;

    const { rolesHavePermission } = await import("@/lib/auth/permissions");
    const canSeeAll = rolesHavePermission(context.user.roles, PERMISSIONS.VEHICLE_UPDATE);
    const inspectorUserId = canSeeAll
      ? (params.get("inspectorUserId") ?? undefined)
      : context.user.id;

    const inspections = await listInspections({
      vehicleId: params.get("vehicleId") ?? undefined,
      inspectorUserId,
      limit,
    });
    return jsonOk({ inspections });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/inspections
 * Submit a pre-trip or return inspection (inspection:submit).
 *
 * Items are matched against the default checklist by key; a failed CRITICAL
 * item creates a linked VehicleIssue (idempotent per inspection+item) and the
 * server applies a safety hold. The inspection never pretends to be a repair.
 * The odometer is recorded through the ledger.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.INSPECTION_SUBMIT);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId : "";
    const type = typeof body.type === "string" ? body.type : "PRE_TRIP";
    const odometerKm = Number(body.odometerKm);
    if (!vehicleId) throw ApiError.badRequest("vehicleId is required");
    if (type !== "PRE_TRIP" && type !== "RETURN") {
      throw ApiError.badRequest("type must be PRE_TRIP or RETURN");
    }
    if (!Number.isSafeInteger(odometerKm) || odometerKm < 0) {
      throw ApiError.badRequest("odometerKm is required (non-negative integer)");
    }

    const vehicle = await getVehicleById(vehicleId);
    if (!vehicle) throw ApiError.badRequest("Unknown vehicleId");

    // Build items from the checklist, taking results from the submission.
    const submitted = Array.isArray(body.items) ? (body.items as unknown[]) : [];
    const resultByKey = new Map<
      string,
      { result: string; notes?: string; evidenceKeys?: string[] }
    >();
    for (const raw of submitted) {
      const item = raw as Record<string, unknown>;
      const key = typeof item.key === "string" ? item.key : "";
      if (!key) continue;
      resultByKey.set(key, {
        result: typeof item.result === "string" ? item.result : "PASS",
        notes: typeof item.notes === "string" ? item.notes.slice(0, 500) : undefined,
        evidenceKeys: Array.isArray(item.evidenceKeys)
          ? item.evidenceKeys.filter((k): k is string => typeof k === "string").slice(0, 5)
          : [],
      });
    }

    const items: InspectionItem[] = defaultChecklist().map((template) => {
      const given = resultByKey.get(template.key);
      const result =
        given && (INSPECTION_RESULTS as readonly string[]).includes(given.result)
          ? (given.result as InspectionResult)
          : "PASS";
      return { ...template, result, notes: given?.notes, evidenceKeys: given?.evidenceKeys ?? [] };
    });

    const overall = overallResult(items);
    const failedCritical = items.filter((i) => i.critical && i.result === "FAIL");

    // Record the odometer through the ledger first (transactional).
    const reading = await recordReading({
      vehicleId,
      km: odometerKm,
      source: type === "PRE_TRIP" ? "PRE_TRIP_INSPECTION" : "POST_TRIP_INSPECTION",
      recordedByUserId: context.user.id,
      notes: `${type} inspection`,
      clientToken: typeof body.clientToken === "string" ? `insp-${body.clientToken}` : undefined,
    });

    // Create one issue per failed critical item — idempotent per inspection.
    const issueIds: string[] = [];
    for (const failed of failedCritical) {
      const issue = await createIssue({
        vehicleId,
        reportedBy: context.user.id,
        title: `${type === "PRE_TRIP" ? "Pre-trip" : "Return"} check failed: ${failed.label}`,
        description:
          failed.notes ??
          `Critical checklist item "${failed.label}" failed during the ${type.toLowerCase()} inspection.`,
        severity: "CRITICAL",
        category: "OTHER",
        safetyCritical: true,
        affectsSafeOperation: true,
        odometerKm,
        assignmentId: typeof body.assignmentId === "string" ? body.assignmentId : undefined,
        evidenceKeys: failed.evidenceKeys,
        clientToken: body.clientToken ? `insp-${body.clientToken}-${failed.key}` : undefined,
      });
      issueIds.push(issue.id);
    }

    // Also capture the driver's active assignment if provided implicitly.
    let assignmentId = typeof body.assignmentId === "string" ? body.assignmentId : undefined;
    if (!assignmentId && type === "PRE_TRIP") {
      const active = await getActiveAssignmentForDriver(context.user.id);
      if (active && active.vehicleId === vehicleId) assignmentId = active.id;
    }

    const inspection = await submitInspection({
      vehicleId,
      inspectorUserId: context.user.id,
      type: type as "PRE_TRIP" | "RETURN",
      assignmentId,
      odometerKm,
      odometerReadingId: reading.reading.id,
      items,
      overall,
      issueIds,
      clientToken:
        typeof body.clientToken === "string" ? body.clientToken.slice(0, 100) : undefined,
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.INSPECTION_SUBMITTED,
      actorId: context.user.id,
      entityType: "inspection",
      entityId: inspection.id,
      after: { vehicleId, type, overall, failedCritical: failedCritical.length, issueIds },
      requestId,
    });

    // Stage 2 — safety assessment: any failed critical item restricts the
    // vehicle immediately, server-side, with the causing issues linked.
    let safetyHoldApplied = false;
    if (failedCritical.length > 0 && vehicle.status !== "SAFETY_HOLD") {
      await applyVehicleStatus(vehicleId, "SAFETY_HOLD", {
        safetyHoldReason: `Failed critical inspection items (${failedCritical.map((f) => f.key).join(", ")})`,
        actorId: context.user.id,
        issueId: issueIds[0],
      });
      safetyHoldApplied = true;
      await writeAuditEvent({
        eventType: AUDIT_EVENTS.SAFETY_HOLD_APPLIED,
        actorId: context.user.id,
        entityType: "vehicle",
        entityId: vehicleId,
        reason: `automatic hold from inspection ${inspection.id}`,
        requestId,
      });
    }

    return jsonOk({ inspection, issueIds, safetyHoldApplied }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
