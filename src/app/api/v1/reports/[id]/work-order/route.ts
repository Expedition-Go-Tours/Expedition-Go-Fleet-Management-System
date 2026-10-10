import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { WORK_ORDER_PRIORITIES, type WorkOrder } from "@/lib/domain/work-order";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { getIssueById, linkIssueToWorkOrder } from "@/lib/repos/reports";
import { createWorkOrder } from "@/lib/repos/work-orders";

export const runtime = "nodejs";

/**
 * POST /api/v1/reports/[id]/work-order
 * Create a work order from this issue (work_order:create). Prefills vehicle,
 * title and description from the issue and links both directions.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.WORK_ORDER_CREATE);

    const { id } = await params;
    const issue = await getIssueById(id);
    if (!issue) throw ApiError.notFound("Issue not found");
    if (issue.status === "CLOSED") {
      throw ApiError.conflict("Cannot create a work order for a closed issue");
    }
    if (issue.linkedWorkOrderIds.length > 0) {
      throw ApiError.conflict("This issue is already linked to a work order");
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const description = typeof body?.description === "string" ? body.description.trim() : "";
    const priority = typeof body?.priority === "string" ? body.priority : "NORMAL";
    const assignedToUserId =
      typeof body?.assignedToUserId === "string" ? body.assignedToUserId.trim() : undefined;
    if (!(WORK_ORDER_PRIORITIES as readonly string[]).includes(priority)) {
      throw ApiError.badRequest(`Priority must be one of: ${WORK_ORDER_PRIORITIES.join(", ")}`);
    }

    const workOrder = await createWorkOrder({
      vehicleId: issue.vehicleId,
      issueIds: [issue.id],
      title: issue.title,
      description: description || issue.description,
      priority: priority as WorkOrder["priority"],
      assignedToUserId,
      createdBy: context.user.id,
    });
    await linkIssueToWorkOrder(issue.id, workOrder.id);

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.WORK_ORDER_CREATED,
      actorId: context.user.id,
      entityType: "workOrder",
      entityId: workOrder.id,
      after: {
        issueId: issue.id,
        issueNumber: issue.number ?? null,
        vehicleId: issue.vehicleId,
        number: workOrder.number,
        priority,
      },
      requestId,
    });

    return jsonOk(
      { workOrder, report: { ...issue, linkedWorkOrderIds: [workOrder.id] } },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
