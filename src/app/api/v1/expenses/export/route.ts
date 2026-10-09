import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { jsonOk, toErrorResponse } from "@/lib/api/errors";
import { requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { listExpenses, totalPaidMinor } from "@/lib/repos/expenses";

export const runtime = "nodejs";

/**
 * GET /api/v1/expenses/export
 * Finance export: paid-expense totals as CSV or JSON.
 * Requires expense:export (FINANCE baseline). Recorded in the audit log.
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

    const paidExpenses = (
      await listExpenses({ vehicleId, workOrderId, status: "PAID", limit: 1000 })
    ).filter((expense) => expense.status === "PAID");
    const totalMinor = await totalPaidMinor({ vehicleId, workOrderId });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.EXPORT_GENERATED,
      actorId: context.user.id,
      entityType: "expense",
      reason: `export ${format} (${paidExpenses.length} rows)`,
      requestId,
    });

    if (format === "json") {
      return jsonOk({
        expenses: paidExpenses,
        totalMinor,
        currency: paidExpenses[0]?.currency ?? "GHS",
        count: paidExpenses.length,
      });
    }

    const header = "id,workOrderId,vehicleId,category,amountMinor,currency,description,paidAt";
    const rows = paidExpenses.map((e) =>
      [
        e.id,
        e.workOrderId,
        e.vehicleId,
        e.category,
        e.amountMinor,
        e.currency,
        // Escape quotes/commas for CSV safety.
        `"${e.description.replace(/"/g, '""')}"`,
        e.paidAt ? e.paidAt.toISOString() : "",
      ].join(","),
    );
    const csv = [header, ...rows, `TOTAL,,,,${totalMinor},,,,`].join("\n");

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
