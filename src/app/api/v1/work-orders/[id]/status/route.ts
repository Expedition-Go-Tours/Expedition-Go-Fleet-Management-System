import { makeActionHandler } from "@/lib/api/action";
import { WORK_ORDER_ACTIONS, type WorkOrder, type WorkOrderStatus } from "@/lib/domain/work-order";
import { AUDIT_EVENTS } from "@/lib/repos/audit";
import { applyWorkOrderStatus, getWorkOrderById } from "@/lib/repos/work-orders";

export const runtime = "nodejs";

/**
 * POST /api/v1/work-orders/[id]/status
 * Work order lifecycle actions: start | complete | close | reopen
 * Permission comes from the action map (work_order:update / :complete /
 * :close / :reopen). The pipeline is enforced by the state machine.
 */
export const POST = makeActionHandler<WorkOrderStatus, WorkOrder>({
  actions: WORK_ORDER_ACTIONS,
  auditEventType: AUDIT_EVENTS.WORK_ORDER_STATUS_CHANGED,
  entityType: "workOrder",
  jsonKey: "workOrder",
  load: getWorkOrderById,
  apply: (entity, def) => applyWorkOrderStatus(entity.id, def.to),
});
