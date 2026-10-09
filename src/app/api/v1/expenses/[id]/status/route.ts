import { makeActionHandler } from "@/lib/api/action";
import { EXPENSE_ACTIONS, type Expense, type ExpenseStatus } from "@/lib/domain/expense";
import { AUDIT_EVENTS } from "@/lib/repos/audit";
import { applyExpenseStatus, getExpenseById } from "@/lib/repos/expenses";

export const runtime = "nodejs";

/**
 * POST /api/v1/expenses/[id]/status
 * Expense lifecycle actions: approve | mark_paid | void
 * Permissions come from the action map (expense:update / :payment:update /
 * :void). The financial chain and VOID/PAID terminality are enforced by the
 * state machine; paid expenses can never be voided.
 */
export const POST = makeActionHandler<ExpenseStatus, Expense>({
  actions: EXPENSE_ACTIONS,
  auditEventType: AUDIT_EVENTS.EXPENSE_STATUS_CHANGED,
  entityType: "expense",
  jsonKey: "expense",
  load: getExpenseById,
  apply: (entity, def, _body, actorId) => applyExpenseStatus(entity.id, def.to, actorId),
});
