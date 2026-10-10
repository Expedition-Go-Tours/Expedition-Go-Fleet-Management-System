import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { CompletionError, completeWorkOrder } from "@/lib/domain/work-order-completion";
import { getScheduleById } from "@/lib/repos/maintenance";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { getWorkOrderById } from "@/lib/repos/work-orders";

export const runtime = "nodejs";

/**
 * POST /api/v1/work-orders/[id]/complete
 * Record real completion evidence (work_order:complete).
 *
 * Required: workPerformed and odometerKm. The completion workflow creates an
 * immutable ServiceRecord (once per work order), resets only the named
 * schedules, resolves linked issues and records the completion odometer in
 * the ledger. Replays are idempotent.
 *
 * A completed work order NEVER releases a safety hold — release is a
 * separate vehicle:release action that re-checks open critical issues.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.WORK_ORDER_COMPLETE);

    const routeParams = await params;
    const workOrderId = routeParams.id;
    const workOrder = await getWorkOrderById(workOrderId);
    if (!workOrder) throw ApiError.notFound("Work order not found");
    // Note: completed work orders are handled by completeWorkOrder's
    // idempotency check — a replay returns the existing service record.

    const parsed = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!parsed) throw ApiError.badRequest("Invalid JSON body");

    const workPerformed =
      typeof parsed.workPerformed === "string" ? parsed.workPerformed.trim() : "";
    if (!workPerformed || workPerformed.length > 5000) {
      throw ApiError.badRequest("workPerformed is required (max 5000 chars)");
    }
    const odometerKm = Number(parsed.odometerKm);
    if (!Number.isSafeInteger(odometerKm) || odometerKm < 0) {
      throw ApiError.badRequest("odometerKm is required (non-negative integer)");
    }

    let completedAt = new Date();
    if (parsed.completedAt !== undefined) {
      const candidate = new Date(String(parsed.completedAt));
      if (Number.isNaN(candidate.getTime())) {
        throw ApiError.badRequest("completedAt must be a valid date");
      }
      if (candidate.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
        throw ApiError.badRequest("completedAt cannot be in the future");
      }
      completedAt = candidate;
    }

    // Named schedules must belong to this vehicle — only they are reset.
    const scheduleIds = Array.isArray(parsed.scheduleIds)
      ? parsed.scheduleIds.filter((s): s is string => typeof s === "string").slice(0, 20)
      : [];
    for (const scheduleId of scheduleIds) {
      const schedule = await getScheduleById(scheduleId);
      if (!schedule || schedule.vehicleId !== workOrder.vehicleId) {
        throw ApiError.badRequest("Unknown or mismatched scheduleId: " + scheduleId);
      }
    }

    // Supplied issue ids are validated against the authoritative work-order
    // relationships inside completeWorkOrder — they are never trusted just
    // because the caller holds work_order:complete. Reject malformed input here
    // instead of silently truncating it (truncation would close fewer issues
    // than the user confirmed).
    let resolvedIssueIds = workOrder.issueIds;
    if (parsed.resolvedIssueIds !== undefined) {
      if (!Array.isArray(parsed.resolvedIssueIds)) {
        throw ApiError.badRequest("resolvedIssueIds must be an array");
      }
      if (parsed.resolvedIssueIds.some((s) => typeof s !== "string")) {
        throw ApiError.badRequest("resolvedIssueIds must contain only strings");
      }
      if (parsed.resolvedIssueIds.length > 20) {
        throw ApiError.badRequest("Too many resolvedIssueIds (max 20)");
      }
      resolvedIssueIds = parsed.resolvedIssueIds as string[];
    }

    const result = await completeWorkOrder({
      workOrderId,
      completedAt,
      odometerKm,
      workPerformed,
      outcome: typeof parsed.outcome === "string" ? parsed.outcome.slice(0, 2000) : undefined,
      providerName:
        typeof parsed.providerName === "string" ? parsed.providerName.slice(0, 200) : undefined,
      technicianName:
        typeof parsed.technicianName === "string" ? parsed.technicianName.slice(0, 200) : undefined,
      notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 2000) : undefined,
      scheduleIds,
      resolvedIssueIds,
      recordedByUserId: context.user.id,
    });

    if (!result.duplicate) {
      await writeAuditEvent({
        eventType: AUDIT_EVENTS.SERVICE_RECORDED,
        actorId: context.user.id,
        entityType: "serviceRecord",
        entityId: result.serviceRecord.id,
        after: {
          workOrderId,
          vehicleId: workOrder.vehicleId,
          odometerKm,
          resetScheduleIds: result.resetScheduleIds,
          resolvedIssueIds,
        },
        requestId,
      });
    }

    return jsonOk({
      serviceRecord: result.serviceRecord,
      duplicate: result.duplicate,
      resetScheduleIds: result.resetScheduleIds,
    });
  } catch (error) {
    if (error instanceof CompletionError) {
      const status =
        error.code === "NOT_FOUND" || error.code === "VEHICLE_NOT_FOUND"
          ? 404
          : error.code === "ALREADY_COMPLETE" || error.code === "DECREASE_REJECTED"
            ? 409
            : 400;
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
    }
    return toErrorResponse(error);
  }
}
