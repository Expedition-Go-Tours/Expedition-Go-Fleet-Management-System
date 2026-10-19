import { makeActionHandler } from "@/lib/api/action";
import { ApiError } from "@/lib/api/errors";
import { EXPENSE_ACTIONS, type Expense, type ExpenseStatus } from "@/lib/domain/expense";
import { AUDIT_EVENTS } from "@/lib/repos/audit";
import { approveExpense, getExpenseById, rejectExpense, voidExpense } from "@/lib/repos/expenses";

export const runtime = "nodejs";

/**
 * POST /api/v1/expenses/[id]/status
 * Expense lifecycle actions: approve | reject | void.
 *
 *   approve  PENDING  → APPROVED   (expense:approve)
 *   reject   PENDING  → REJECTED   (expense:approve, reason required)
 *   void     APPROVED → VOID       (expense:void,    reason required)
 *
 * A recorded expense is never deleted; every transition is audited with
 * before/after status, so the financial history stays complete.
 */
export const POST = makeActionHandler<ExpenseStatus, Expense>({
  actions: EXPENSE_ACTIONS,
  auditEventType: AUDIT_EVENTS.EXPENSE_STATUS_CHANGED,
  entityType: "expense",
  jsonKey: "expense",
  load: getExpenseById,
  assertAllowed: async (_entity, def, body) => {
    if (def.to === "REJECTED" || def.to === "VOID") {
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!reason || reason.length > 1000) {
        throw ApiError.badRequest(
          `${def.to === "VOID" ? "Voiding" : "Rejecting"} an expense requires a reason (max 1000 chars)`,
        );
      }
    }
  },
  apply: async (entity, def, body, actorId) => {
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (def.to === "APPROVED") return approveExpense(entity.id, actorId);
    if (def.to === "REJECTED") return rejectExpense(entity.id, actorId, reason);
    return voidExpense(entity.id, actorId, reason);
  },
});
