import { makeActionHandler } from "@/lib/api/action";
import { REPORT_ACTIONS, type MaintenanceReport, type ReportStatus } from "@/lib/domain/report";
import { AUDIT_EVENTS } from "@/lib/repos/audit";
import { applyReportStatus, getReportById } from "@/lib/repos/reports";

export const runtime = "nodejs";

/**
 * POST /api/v1/reports/[id]/status
 * Report lifecycle actions: triage | close
 * Permission comes from the action map (report:triage / report:close).
 */
export const POST = makeActionHandler<ReportStatus, MaintenanceReport>({
  actions: REPORT_ACTIONS,
  auditEventType: AUDIT_EVENTS.REPORT_STATUS_CHANGED,
  entityType: "report",
  jsonKey: "report",
  load: getReportById,
  apply: (entity, def, _body, actorId) => applyReportStatus(entity.id, def.to, actorId),
});
