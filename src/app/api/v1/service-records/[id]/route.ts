import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { parseDeletionReason } from "@/lib/domain/deletion";
import { parsePaidTo } from "@/lib/domain/expense";
import {
  correctServiceRecord,
  ServiceCorrectionError,
} from "@/lib/domain/service-correction";
import { resolveServiceCostInput, ServiceCostError } from "@/lib/domain/service-cost";
import { deleteServiceRecord } from "@/lib/repos/maintenance";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";

export const runtime = "nodejs";

/**
 * PATCH /api/v1/service-records/[id]
 * Correct a completed service record (service:update — operations and admin).
 *
 * Editable: completion date, task label, work performed, provider, technician,
 * payee, notes and the cost breakdown. The vehicle and odometer are immutable
 * here — mileage corrections go through the odometer ledger. A date correction
 * moves the schedules this record last reset and the linked expense date, and
 * a cost correction updates the linked MAINTENANCE expense in the same
 * transaction. Every correction is audited with before/after.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.SERVICE_UPDATE);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const workPerformed =
      typeof body.workPerformed === "string" ? body.workPerformed.trim() : "";
    if (!workPerformed || workPerformed.length > 5000) {
      throw ApiError.badRequest("workPerformed is required (max 5000 chars)");
    }

    const completedAtRaw = typeof body.completedAt === "string" ? body.completedAt : "";
    const completedAt = new Date(completedAtRaw);
    if (!completedAtRaw || Number.isNaN(completedAt.getTime())) {
      throw ApiError.badRequest("completedAt must be a valid date");
    }
    if (completedAt.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      throw ApiError.badRequest("completedAt cannot be in the future");
    }

    const explicitTaskName =
      typeof body.taskName === "string" ? body.taskName.trim().slice(0, 200) : "";
    const taskName = explicitTaskName || workPerformed.slice(0, 100) || "Service";

    const paidToResult = parsePaidTo(body.paidTo);
    if (!paidToResult.ok) throw ApiError.badRequest(paidToResult.message);

    const repairCost = resolveServiceCostInput({
      costMinor: body.costMinor,
      labourMinor: body.labourMinor,
      items: body.items,
      currency: body.currency,
    });

    const result = await correctServiceRecord({
      serviceRecordId: id,
      completedAt,
      taskName,
      workPerformed,
      providerName:
        typeof body.providerName === "string"
          ? body.providerName.trim().slice(0, 200) || undefined
          : undefined,
      technicianName:
        typeof body.technicianName === "string"
          ? body.technicianName.trim().slice(0, 200) || undefined
          : undefined,
      paidTo: paidToResult.paidTo,
      notes:
        typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) || undefined : undefined,
      repairCost,
      actorId: context.user.id,
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.SERVICE_CORRECTED,
      actorId: context.user.id,
      entityType: "serviceRecord",
      entityId: id,
      before: {
        taskName: result.before.taskName,
        completedAt: result.before.completedAt.toISOString(),
        workPerformed: result.before.workPerformed,
        providerName: result.before.providerName ?? null,
        technicianName: result.before.technicianName ?? null,
        paidTo: result.before.paidTo ?? null,
        notes: result.before.notes ?? null,
        repairCostMinor: result.before.repairCostMinor ?? null,
        labourCostMinor: result.before.labourCostMinor ?? null,
        costItems: result.before.costItems ?? null,
      },
      after: {
        taskName: result.after.taskName,
        completedAt: result.after.completedAt.toISOString(),
        workPerformed: result.after.workPerformed,
        providerName: result.after.providerName ?? null,
        technicianName: result.after.technicianName ?? null,
        paidTo: result.after.paidTo ?? null,
        notes: result.after.notes ?? null,
        repairCostMinor: result.after.repairCostMinor ?? null,
        labourCostMinor: result.after.labourCostMinor ?? null,
        costItems: result.after.costItems ?? null,
        expenseId: result.expenseId ?? null,
      },
      requestId,
    });

    return jsonOk({
      serviceRecord: result.after,
      expenseCreated: result.expenseCreated,
    });
  } catch (error) {
    if (error instanceof ServiceCorrectionError) {
      const status =
        error.code === "SERVICE_NOT_FOUND" ? 404 : error.code === "COST_NOT_RECORDED" ? 502 : 400;
      return NextResponse.json(
        {
          error: { code: error.code, message: error.message },
          ...(error.code === "COST_NOT_RECORDED" ? { retryable: true } : {}),
        },
        { status },
      );
    }
    if (error instanceof ServiceCostError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: 400 },
      );
    }
    return toErrorResponse(error);
  }
}

/**
 * DELETE /api/v1/service-records/[id]
 *
 * Permanently remove one completed service record (service:delete — ADMIN
 * only). A written reason is required and the full record plus cleanup summary
 * are captured in the audit log. Linked MAINTENANCE expenses are deleted with
 * it; schedules this record last reset lose their baseline (they return to
 * NOT_CONFIGURED), odometer readings keep their mileage but lose the service
 * link, and a linked work order keeps the job but loses the service link.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.SERVICE_DELETE);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const reason = parseDeletionReason(body?.reason);

    const result = await deleteServiceRecord(id, {
      eventType: AUDIT_EVENTS.SERVICE_DELETED,
      actorId: context.user.id,
      entityType: "serviceRecord",
      entityId: id,
      reason,
      requestId,
    });

    return jsonOk({
      deleted: true,
      deletedExpenseIds: result.deletedExpenseIds,
      clearedScheduleIds: result.clearedScheduleIds,
      unlinkedOdometerReadingIds: result.unlinkedOdometerReadingIds,
      unlinkedWorkOrderId: result.unlinkedWorkOrderId ?? null,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
