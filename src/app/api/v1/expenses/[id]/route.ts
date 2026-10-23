import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { parseDeletionReason } from "@/lib/domain/deletion";
import { AUDIT_EVENTS } from "@/lib/repos/audit";
import { deleteExpenseRecord } from "@/lib/repos/expenses";

export const runtime = "nodejs";

/**
 * DELETE /api/v1/expenses/[id]
 *
 * Permanently remove one expense (expense:delete — ADMIN only). A written
 * reason is mandatory and the full record is captured in the audit log before
 * it disappears. The source fuel/service record is unlinked in the same
 * transaction; a service record's cost intent is cleared when this was its
 * only expense, while a fuel purchase keeps its recorded amount.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.EXPENSE_DELETE);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const reason = parseDeletionReason(body?.reason);

    const result = await deleteExpenseRecord(id, {
      eventType: AUDIT_EVENTS.EXPENSE_DELETED,
      actorId: context.user.id,
      entityType: "expense",
      entityId: id,
      reason,
      requestId,
    });

    return jsonOk({
      deleted: true,
      unlinkedFuelEntryId: result.unlinkedFuelEntryId ?? null,
      unlinkedServiceRecordId: result.unlinkedServiceRecordId ?? null,
      clearedServiceCost: result.clearedServiceCost,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
