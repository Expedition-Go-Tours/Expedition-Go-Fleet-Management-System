import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
  type WorkOrderStatus,
} from "@/lib/domain/work-order";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { getIssueById, linkIssueToWorkOrder } from "@/lib/repos/reports";
import { createWorkOrder, listWorkOrders } from "@/lib/repos/work-orders";
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
    if (statusParam && !(WORK_ORDER_STATUSES as readonly string[]).includes(statusParam)) {
      throw ApiError.badRequest(`status must be one of: ${WORK_ORDER_STATUSES.join(", ")}`);
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
 * Create a work order. Requires work_order:create.
 *
 * A work order can address multiple issues (`issueIds`) and preventive-
 * maintenance tasks (`scheduleIds`). The issue↔work-order relationship is
 * written in both directions so either side can navigate to the other.
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
    const assignedToUserId =
      typeof body.assignedToUserId === "string" ? body.assignedToUserId.trim() : undefined;
    const providerName =
      typeof body.providerName === "string" ? body.providerName.trim() : undefined;
    const issueIds = Array.isArray(body.issueIds)
      ? body.issueIds.filter((i): i is string => typeof i === "string").slice(0, 20)
      : typeof body.reportId === "string"
        ? [body.reportId]
        : [];
    const scheduleIds = Array.isArray(body.scheduleIds)
      ? body.scheduleIds.filter((i): i is string => typeof i === "string").slice(0, 20)
      : [];
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

    // Resolve vehicle from the first linked issue when creating from an issue.
    const validatedIssues: string[] = [];
    for (const issueId of issueIds) {
      const issue = await getIssueById(issueId);
      if (!issue) throw ApiError.badRequest(`Unknown issueId: ${issueId}`);
      if (issue.status === "CLOSED") {
        throw ApiError.conflict(`Issue ${issue.number ?? issueId} is closed`);
      }
      if (vehicleId && vehicleId !== issue.vehicleId) {
        throw ApiError.badRequest("All issues must belong to the same vehicle");
      }
      vehicleId = issue.vehicleId;
      validatedIssues.push(issue.id);
    }

    if (!vehicleId) throw ApiError.badRequest("vehicleId (or at least one issueId) is required");
    const vehicle = await getVehicleById(vehicleId);
    if (!vehicle) throw ApiError.badRequest("Unknown vehicleId");
    if (vehicle.status === "ARCHIVED") {
      throw ApiError.conflict("Cannot create a work order for an archived vehicle");
    }

    const workOrder = await createWorkOrder({
      vehicleId,
      issueIds: validatedIssues,
      scheduleIds,
      title,
      description,
      priority: priority as import("@/lib/domain/work-order").WorkOrder["priority"],
      assignedToUserId,
      providerName,
      createdBy: context.user.id,
    });

    // Bidirectional links: issue → work order.
    for (const issueId of validatedIssues) {
      await linkIssueToWorkOrder(issueId, workOrder.id);
    }

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.WORK_ORDER_CREATED,
      actorId: context.user.id,
      entityType: "workOrder",
      entityId: workOrder.id,
      after: {
        vehicleId,
        number: workOrder.number,
        issueIds: validatedIssues,
        scheduleIds,
        priority,
      },
      requestId,
    });

    return jsonOk({ workOrder }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
