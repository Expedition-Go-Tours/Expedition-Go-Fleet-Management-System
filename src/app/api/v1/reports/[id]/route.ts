import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { requireAuthContext } from "@/lib/auth/guards";
import { PERMISSIONS, rolesHavePermission } from "@/lib/auth/permissions";
import { getReportById } from "@/lib/repos/reports";

export const runtime = "nodejs";

/**
 * GET /api/v1/reports/[id]
 * Read one report. Ownership-aware: users with only report:read:own can read
 * their own reports; report:read:all reads any.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAuthContext();
    const { id } = await params;
    const report = await getReportById(id);
    if (!report) throw ApiError.notFound("Report not found");

    const canReadAll = rolesHavePermission(context.user.roles, PERMISSIONS.REPORT_READ_ALL);
    const isOwner = report.reportedBy === context.user.id;
    if (
      !canReadAll &&
      !(isOwner && rolesHavePermission(context.user.roles, PERMISSIONS.REPORT_READ_OWN))
    ) {
      throw ApiError.forbidden("You do not have permission to read this report");
    }
    return jsonOk({ report });
  } catch (error) {
    return toErrorResponse(error);
  }
}
