import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { voidExpense, getExpenseById } from "@/lib/repos/expenses";

export const runtime = "nodejs";

/**
 * POST /api/v1/expenses/[id]/status
 * The only expense lifecycle action: void (RECORDED → VOID).
 * Approval happens outside this system; a void requires a reason and is
 * audited. The record is never deleted.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.EXPENSE_VOID);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = body?.action;
    if (action !== "void") {
      throw ApiError.badRequest(
        `Unknown action "${action}". Only "void" is supported`,
        "UNKNOWN_ACTION",
      );
    }
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason || reason.length > 1000) {
      throw ApiError.badRequest("Voiding an expense requires a reason (max 1000 chars)");
    }

    const expense = await getExpenseById(id);
    if (!expense) throw ApiError.notFound("Expense not found");
    if (expense.status !== "RECORDED") {
      throw ApiError.conflict(`Expense is ${expense.status}; only RECORDED expenses can be voided`);
    }

    const updated = await voidExpense(id, context.user.id, reason);

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.EXPENSE_STATUS_CHANGED,
      actorId: context.user.id,
      entityType: "expense",
      entityId: id,
      before: { status: "RECORDED" },
      after: { status: "VOID" },
      reason,
      requestId,
    });

    return jsonOk({ expense: updated, action: "void" });
  } catch (error) {
    return toErrorResponse(error);
  }
}
