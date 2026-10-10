import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { jsonOk, toErrorResponse } from "@/lib/api/errors";
import { requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { listExpenses, totalExpensesMinor } from "@/lib/repos/expenses";

export const runtime = "nodejs";

/**
 * GET /api/v1/expenses/export
 * Expense export as CSV or JSON (expense:export). Non-VOID expenses only;
 * the export itself is audited.
 * Query: ?format=csv|json (default csv), ?vehicleId=, ?workOrderId=
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.EXPENSE_EXPORT);

    const params = request.nextUrl.searchParams;
    const format = params.get("format") === "json" ? "json" : "csv";
    const vehicleId = params.get("vehicleId") ?? undefined;
    const workOrderId = params.get("workOrderId") ?? undefined;

    const expenses = (await listExpenses({ vehicleId, workOrderId, limit: 2000 })).filter(
      (e) => e.status !== "VOID",
    );
    const totalMinor = await totalExpensesMinor({ vehicleId, workOrderId });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.EXPORT_GENERATED,
      actorId: context.user.id,
      entityType: "expense",
      reason: `export ${format} (${expenses.length} rows)`,
      requestId,
    });

    if (format === "json") {
      return jsonOk({
        expenses,
        totalMinor,
        currency: expenses[0]?.currency ?? "GHS",
        count: expenses.length,
      });
    }

    const header =
      "id,incurredOn,vehicleId,workOrderId,serviceRecordId,category,amountMinor,currency,description,supplier,externalReference";
    const rows = expenses.map((e) =>
      [
        e.id,
        e.incurredOn.toISOString().slice(0, 10),
        e.vehicleId,
        e.workOrderId ?? "",
        e.serviceRecordId ?? "",
        e.category,
        e.amountMinor,
        e.currency,
        `"${e.description.replace(/"/g, '""')}"`,
        e.supplierName ? `"${e.supplierName.replace(/"/g, '""')}"` : "",
        e.externalReference ?? "",
      ].join(","),
    );
    const csv = [header, ...rows, `TOTAL,,,,,,,${totalMinor},,,`].join("\n");

    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="expenses-export.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
