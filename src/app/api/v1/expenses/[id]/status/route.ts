import { makeActionHandler } from "@/lib/api/action";
import { ApiError } from "@/lib/api/errors";
import { EXPENSE_ACTIONS, type Expense, type ExpenseStatus } from "@/lib/domain/expense";
import { AUDIT_EVENTS } from "@/lib/repos/audit";
import { getExpenseById, voidExpense } from "@/lib/repos/expenses";

export const runtime = "nodejs";

/**
 * POST /api/v1/expenses/[id]/status
 * The single expense correction: void (expense:void, reason required).
 *
 *   void  PENDING | APPROVED → VOID
 *
 * A newly recorded expense can be corrected immediately — there is no approval
 * step to wait for. The record is never deleted; the transition is audited
 * with before/after status so the financial history stays complete.
 */
export const POST = makeActionHandler<ExpenseStatus, Expense>({
  actions: EXPENSE_ACTIONS,
  auditEventType: AUDIT_EVENTS.EXPENSE_STATUS_CHANGED,
  entityType: "expense",
  jsonKey: "expense",
  load: getExpenseById,
  assertAllowed: async (_entity, _def, body) => {
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason || reason.length > 1000) {
      throw ApiError.badRequest("Voiding an expense requires a reason (max 1000 chars)");
    }
  },
  apply: async (entity, _def, body, actorId) => {
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    return voidExpense(entity.id, actorId, reason);
  },
});
