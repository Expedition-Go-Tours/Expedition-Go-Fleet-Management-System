import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { requireAuthContext } from "@/lib/auth/guards";
import { PERMISSIONS, rolesHavePermission } from "@/lib/auth/permissions";
import { listIssues } from "@/lib/repos/reports";
import { listVehicles } from "@/lib/repos/vehicles";
import { listWorkOrders } from "@/lib/repos/work-orders";

export const runtime = "nodejs";

export interface SearchHit {
  id: string;
  label: string;
  sublabel: string;
  href: string;
}

export interface SearchResponse {
  query: string;
  vehicles: SearchHit[];
  issues: SearchHit[];
  workOrders: SearchHit[];
  /** Lower-cased prefix match used by the client to highlight. */
  matched: string;
}

/**
 * GET /api/v1/search?q=… — permission-aware global search.
 * Per-collection equality queries + in-memory substring filtering (the same
 * query strategy as every list page; no composite indexes). Each group is
 * gated by its read permission and capped so the header search stays fast.
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();

    const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 2) {
      throw ApiError.badRequest("Search query must be at least 2 characters");
    }
    const needle = q.toLowerCase();

    const response: SearchResponse = { query: q, vehicles: [], issues: [], workOrders: [], matched: needle };

    const canReadVehicles = rolesHavePermission(context.user.roles, PERMISSIONS.VEHICLE_READ);
    const canReadAllReports = rolesHavePermission(context.user.roles, PERMISSIONS.REPORT_READ_ALL);
    const canReadWorkOrders = rolesHavePermission(context.user.roles, PERMISSIONS.WORK_ORDER_READ);

    if (canReadVehicles) {
      const vehicles = await listVehicles({ limit: 200 });
      response.vehicles = vehicles
        .filter((v) =>
          [v.regNumber, v.make, v.model, String(v.year)]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
        .slice(0, 5)
        .map((v) => ({
          id: v.id,
          label: v.regNumber,
          sublabel: `${v.make} ${v.model} · ${v.type.replace(/_/g, " ").toLowerCase()}`,
          href: `/vehicles/${v.id}`,
        }));
    }

    const issues = await listIssues({
      ...(canReadAllReports ? {} : { reportedBy: context.user.id }),
      limit: 300,
    });
    response.issues = issues
      .filter((issue) => `${issue.number ?? ""} ${issue.title}`.toLowerCase().includes(needle))
      .slice(0, 5)
      .map((issue) => ({
        id: issue.id,
        label: issue.title,
        sublabel: `${issue.number ?? "Issue"} · ${issue.severity.toLowerCase()}`,
        href: `/reports/${issue.id}`,
      }));

    if (canReadWorkOrders) {
      const workOrders = await listWorkOrders({ limit: 300 });
      response.workOrders = workOrders
        .filter((wo) => `${wo.number} ${wo.title}`.toLowerCase().includes(needle))
        .slice(0, 5)
        .map((wo) => ({
          id: wo.id,
          label: wo.title,
          sublabel: `${wo.number} · ${wo.status.replace(/_/g, " ").toLowerCase()}`,
          href: `/work-orders/${wo.id}`,
        }));
    }

    return jsonOk(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}