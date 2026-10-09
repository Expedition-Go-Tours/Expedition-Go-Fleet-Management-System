import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { WORK_ORDER_PRIORITIES } from "@/lib/domain/work-order";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { getWorkOrderById, updateWorkOrder } from "@/lib/repos/work-orders";

export const runtime = "nodejs";

/**
 * GET /api/v1/work-orders/[id]
 * Read one work order. Requires work_order:read.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.WORK_ORDER_READ);

    const { id } = await params;
    const workOrder = await getWorkOrderById(id);
    if (!workOrder) throw ApiError.notFound("Work order not found");
    return jsonOk({ workOrder });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * PATCH /api/v1/work-orders/[id]
 * Update work order details (title/description/priority/assignedTo).
 * Requires work_order:update. `status` is NOT updatable here — status changes
 * go through POST /work-orders/[id]/status.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.WORK_ORDER_UPDATE);

    const { id } = await params;
    const workOrder = await getWorkOrderById(id);
    if (!workOrder) throw ApiError.notFound("Work order not found");

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");
    if ("status" in body) {
      throw ApiError.badRequest(
        "Status cannot be changed here — use POST /work-orders/{id}/status with an action",
      );
    }

    const fields: Parameters<typeof updateWorkOrder>[1] = {};
    if (body.title !== undefined) {
      const value = typeof body.title === "string" ? body.title.trim() : "";
      if (!value || value.length > 200) throw ApiError.badRequest("Invalid title");
      fields.title = value;
    }
    if (body.description !== undefined) {
      const value = typeof body.description === "string" ? body.description.trim() : "";
      if (value.length > 5000) throw ApiError.badRequest("Description is too long");
      fields.description = value;
    }
    if (body.priority !== undefined) {
      if (
        typeof body.priority !== "string" ||
        !(WORK_ORDER_PRIORITIES as readonly string[]).includes(body.priority)
      ) {
        throw ApiError.badRequest(`Priority must be one of: ${WORK_ORDER_PRIORITIES.join(", ")}`);
      }
      fields.priority = body.priority as import("@/lib/domain/work-order").WorkOrder["priority"];
    }
    if (body.assignedTo !== undefined) {
      fields.assignedTo = typeof body.assignedTo === "string" ? body.assignedTo.trim() : undefined;
    }

    if (Object.keys(fields).length === 0) {
      throw ApiError.badRequest("No updatable fields provided");
    }

    const updated = await updateWorkOrder(id, fields);

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.WORK_ORDER_UPDATED,
      actorId: context.user.id,
      entityType: "workOrder",
      entityId: id,
      before: {
        title: workOrder.title,
        priority: workOrder.priority,
        assignedTo: workOrder.assignedTo ?? null,
      },
      after: {
        title: updated.title,
        priority: updated.priority,
        assignedTo: updated.assignedTo ?? null,
      },
      requestId,
    });

    return jsonOk({ workOrder: updated });
  } catch (error) {
    return toErrorResponse(error);
  }
}
