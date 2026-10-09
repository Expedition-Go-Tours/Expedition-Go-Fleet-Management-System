import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { WORK_ORDER_PRIORITIES, type WorkOrder } from "@/lib/domain/work-order";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { getReportById, linkReportToWorkOrder } from "@/lib/repos/reports";
import { createWorkOrder } from "@/lib/repos/work-orders";

export const runtime = "nodejs";

/**
 * POST /api/v1/reports/[id]/work-order
 * Create a work order for this report (work_order:create). Links the report to
 * the new work order so the trail stays connected. Works on OPEN or TRIAGED
 * reports; closed reports cannot receive work orders.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.WORK_ORDER_CREATE);

    const { id } = await params;
    const report = await getReportById(id);
    if (!report) throw ApiError.notFound("Report not found");
    if (report.status === "CLOSED") {
      throw ApiError.conflict("Cannot create a work order for a closed report");
    }
    if (report.workOrderId) {
      throw ApiError.conflict("This report already has a work order");
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const description = typeof body?.description === "string" ? body.description.trim() : "";
    const priority = typeof body?.priority === "string" ? body.priority : "NORMAL";
    const assignedTo = typeof body?.assignedTo === "string" ? body.assignedTo.trim() : undefined;
    if (!(WORK_ORDER_PRIORITIES as readonly string[]).includes(priority)) {
      throw ApiError.badRequest(`Priority must be one of: ${WORK_ORDER_PRIORITIES.join(", ")}`);
    }
    if (description.length > 5000) {
      throw ApiError.badRequest("Description is too long (max 5000 chars)");
    }

    const workOrder = await createWorkOrder({
      vehicleId: report.vehicleId,
      reportId: report.id,
      title: report.title,
      description: description || report.description,
      priority: priority as WorkOrder["priority"],
      assignedTo,
      createdBy: context.user.id,
    });
    await linkReportToWorkOrder(report.id, workOrder.id);

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.WORK_ORDER_CREATED,
      actorId: context.user.id,
      entityType: "workOrder",
      entityId: workOrder.id,
      after: { reportId: report.id, vehicleId: report.vehicleId, priority },
      requestId,
    });

    return jsonOk({ workOrder, report: { ...report, workOrderId: workOrder.id } }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
