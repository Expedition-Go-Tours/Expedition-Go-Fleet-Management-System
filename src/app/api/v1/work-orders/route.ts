import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { WORK_ORDER_PRIORITIES, type WorkOrderStatus } from "@/lib/domain/work-order";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { createWorkOrder, listWorkOrders } from "@/lib/repos/work-orders";
import { getReportById, linkReportToWorkOrder } from "@/lib/repos/reports";
import { getVehicleById } from "@/lib/repos/vehicles";

export const runtime = "nodejs";

/**
 * GET /api/v1/work-orders
 * List work orders. Requires work_order:read.
 * Query: ?vehicleId=&status=&limit=
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.WORK_ORDER_READ);

    const params = request.nextUrl.searchParams;
    const limitRaw = Number(params.get("limit"));
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 500 ? limitRaw : 100;
    const statusParam = params.get("status");
    if (statusParam && !["OPEN", "IN_PROGRESS", "COMPLETED", "CLOSED"].includes(statusParam)) {
      throw ApiError.badRequest("status must be OPEN, IN_PROGRESS, COMPLETED or CLOSED");
    }

    const workOrders = await listWorkOrders({
      vehicleId: params.get("vehicleId") ?? undefined,
      status: (statusParam as WorkOrderStatus | null) ?? undefined,
      limit,
    });
    return jsonOk({ workOrders });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/work-orders
 * Create a standalone work order. Requires work_order:create.
 * Either a vehicleId (required), or a reportId to derive it from.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.WORK_ORDER_CREATE);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const priority = typeof body.priority === "string" ? body.priority : "NORMAL";
    const assignedTo = typeof body.assignedTo === "string" ? body.assignedTo.trim() : undefined;
    const reportId = typeof body.reportId === "string" ? body.reportId.trim() : undefined;
    let vehicleId = typeof body.vehicleId === "string" ? body.vehicleId.trim() : "";

    if (!title || title.length > 200) {
      throw ApiError.badRequest("Title is required (max 200 chars)");
    }
    if (description.length > 5000) {
      throw ApiError.badRequest("Description is too long (max 5000 chars)");
    }
    if (!(WORK_ORDER_PRIORITIES as readonly string[]).includes(priority)) {
      throw ApiError.badRequest(`Priority must be one of: ${WORK_ORDER_PRIORITIES.join(", ")}`);
    }

    // Resolve vehicle from the report when creating from a report.
    if (reportId) {
      const report = await getReportById(reportId);
      if (!report) throw ApiError.badRequest("Unknown reportId");
      if (report.workOrderId) throw ApiError.conflict("That report already has a work order");
      if (report.status === "CLOSED") {
        throw ApiError.conflict("Cannot create a work order for a closed report");
      }
      if (vehicleId && vehicleId !== report.vehicleId) {
        throw ApiError.badRequest("vehicleId does not match the report's vehicle");
      }
      vehicleId = report.vehicleId;
    }

    if (!vehicleId) throw ApiError.badRequest("vehicleId (or reportId) is required");
    const vehicle = await getVehicleById(vehicleId);
    if (!vehicle) throw ApiError.badRequest("Unknown vehicleId");
    if (vehicle.status === "ARCHIVED") {
      throw ApiError.conflict("Cannot create a work order for an archived vehicle");
    }

    const workOrder = await createWorkOrder({
      vehicleId,
      reportId,
      title,
      description,
      priority: priority as import("@/lib/domain/work-order").WorkOrder["priority"],
      assignedTo,
      createdBy: context.user.id,
    });

    if (reportId) {
      await linkReportToWorkOrder(reportId, workOrder.id);
    }

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.WORK_ORDER_CREATED,
      actorId: context.user.id,
      entityType: "workOrder",
      entityId: workOrder.id,
      after: { vehicleId, reportId: reportId ?? null, priority },
      requestId,
    });

    return jsonOk({ workOrder }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
