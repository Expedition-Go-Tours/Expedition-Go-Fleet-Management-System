import { NextRequest } from "next/server";

import { jsonOk, toErrorResponse } from "@/lib/api/errors";
import { requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getServiceRecordById, listServiceRecords } from "@/lib/repos/maintenance";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

/**
 * GET /api/v1/service-records
 * Completed service history (service:read).
 * Query: ?vehicleId= (required for now), ?workOrderId=
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.SERVICE_READ);

    const params = request.nextUrl.searchParams;
    const vehicleId = params.get("vehicleId");
    const workOrderId = params.get("workOrderId");

    if (workOrderId) {
      const { listWorkOrders } = await import("@/lib/repos/work-orders");
      const workOrders = await listWorkOrders({ limit: 2000 });
      const wo = workOrders.find((w) => w.id === workOrderId);
      if (!wo) throw ApiError.notFound("Work order not found");
      const record = wo.serviceRecordId ? await getServiceRecordById(wo.serviceRecordId) : null;
      return jsonOk({ serviceRecords: record ? [record] : [] });
    }

    if (!vehicleId) throw ApiError.badRequest("vehicleId or workOrderId is required");
    const serviceRecords = await listServiceRecords(vehicleId);
    return jsonOk({ serviceRecords });
  } catch (error) {
    return toErrorResponse(error);
  }
}
