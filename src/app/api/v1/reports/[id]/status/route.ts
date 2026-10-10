import { makeActionHandler } from "@/lib/api/action";
import { ApiError } from "@/lib/api/errors";
import { REPORT_ACTIONS, type MaintenanceReport, type ReportStatus } from "@/lib/domain/report";
import { AUDIT_EVENTS } from "@/lib/repos/audit";
import { applyIssueStatus, getIssueById } from "@/lib/repos/reports";

export const runtime = "nodejs";

/**
 * POST /api/v1/reports/[id]/status
 * Issue lifecycle actions: triage | close.
 * Permission comes from the action map (report:triage / report:close).
 * Closing requires an explanation — a resolution, a duplicate link, or a
 * not-actionable reason — so the original report is always accounted for.
 */
export const POST = makeActionHandler<ReportStatus, MaintenanceReport>({
  actions: REPORT_ACTIONS,
  auditEventType: AUDIT_EVENTS.REPORT_STATUS_CHANGED,
  entityType: "issue",
  jsonKey: "report",
  load: getIssueById,
  apply: (entity, def, body, actorId) => {
    if (def.to === "CLOSED") {
      const resolution = typeof body.resolution === "string" ? body.resolution.trim() : "";
      const duplicateOf =
        typeof body.duplicateOfIssueId === "string" ? body.duplicateOfIssueId : undefined;
      const notActionable =
        typeof body.notActionableReason === "string" ? body.notActionableReason.trim() : "";
      if (!resolution && !duplicateOf && !notActionable) {
        throw ApiError.badRequest(
          "Closing an issue requires a resolution, a duplicate link, or a not-actionable reason",
        );
      }
      return applyIssueStatus(entity.id, def.to, actorId, {
        resolution,
        duplicateOfIssueId: duplicateOf,
        notActionableReason: notActionable,
      });
    }
    return applyIssueStatus(entity.id, def.to, actorId);
  },
});
