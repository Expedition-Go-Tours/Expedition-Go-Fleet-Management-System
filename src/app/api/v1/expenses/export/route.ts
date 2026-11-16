import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { jsonOk, toErrorResponse } from "@/lib/api/errors";
import { RATE_LIMITS, enforceRateLimit } from "@/lib/api/rate-limit";
import { requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateRangeLabel, resolveDateRange } from "@/lib/domain/date-range";
import { expenseMatchesLedger } from "@/lib/domain/expense";
import { buildCsv, exportFilename } from "@/lib/export/csv";
import { csvResponse, describeRange, pdfResponse } from "@/lib/export/http";
import { buildExportPdf } from "@/lib/export/pdf";
import { formatDate, formatMoney, humanizeEnum } from "@/lib/format";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { listExpenses } from "@/lib/repos/expenses";
import { listVehicles } from "@/lib/repos/vehicles";

export const runtime = "nodejs";

/**
 * GET /api/v1/expenses/export
 * Expense export as CSV, PDF or JSON (expense:export). Counted expenses only —
 * REJECTED and VOID rows are excluded, matching `summarizeExpenses`, so the
 * exported total never disagrees with the figures on screen. The page's
 * filters (`from`/`to`/`category`/`vehicleId`) are carried through the shared
 * `expenseMatchesLedger` predicate, so the file always matches the ledger.
 * The export itself is audited and rate limited.
 * Query: ?format=csv|pdf|json (default csv), ?from=, ?to=, ?category=, ?vehicleId=
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.EXPENSE_EXPORT);
    enforceRateLimit(`export:${context.user.id}`, RATE_LIMITS.export);

    const params = request.nextUrl.searchParams;
    const requested = params.get("format");
    const format = requested === "json" ? "json" : requested === "pdf" ? "pdf" : "csv";
    const category = params.get("category") || undefined;
    const vehicleId = params.get("vehicleId") || undefined;
    const range = resolveDateRange({ from: params.get("from"), to: params.get("to") });

    const [allExpenses, vehicles] = await Promise.all([
      listExpenses({ vehicleId, limit: 2000 }),
      listVehicles(),
    ]);
    const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
    const expenses = allExpenses.filter(
      (expense) =>
        // Counted rows only — the same rule `summarizeExpenses` applies.
        (expense.status === "PENDING" || expense.status === "APPROVED") &&
        expenseMatchesLedger(expense, { category, vehicleId, range }),
    );
    // Summed from the exported rows so the TOTAL can never disagree with them.
    const totalMinor = expenses.reduce((sum, expense) => sum + expense.amountMinor, 0);

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.EXPORT_GENERATED,
      actorId: context.user.id,
      entityType: "expense",
      reason: `${format} · ${describeRange(range)}${
        category ? ` · ${category}` : ""
      } · ${expenses.length} rows`,
      requestId,
    });

    const filename = exportFilename("expenses", format, range);

    if (format === "json") {
      return jsonOk({
        expenses,
        totalMinor,
        currency: expenses[0]?.currency ?? "GHS",
        count: expenses.length,
      });
    }

    const subtitle = [
      range ? formatDateRangeLabel(range) : "All dates",
      category ? humanizeEnum(category) : "All categories",
      vehicleId ? (vehicleById.get(vehicleId)?.regNumber ?? vehicleId) : "All vehicles",
    ].join(" · ");
    const meta = `Generated ${new Date().toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    })} by ${context.user.email} · ${expenses.length} record(s)`;

    if (format === "pdf") {
      const pdf = buildExportPdf({
        title: "EXPEDITION-GO TOURS LTD EXPENSE RECORD",
        subtitle,
        meta,
        columns: ["Date", "Vehicle", "Category", "Description", "Supplier", "Paid to", "Amount"],
        rows: expenses.map((expense) => [
          formatDate(expense.incurredOn),
          vehicleById.get(expense.vehicleId)?.regNumber ?? "—",
          humanizeEnum(expense.category),
          expense.description,
          expense.supplierName ?? "—",
          expense.paidTo ?? "—",
          formatMoney(expense.amountMinor, expense.currency),
        ]),
        totals: ["TOTAL", "", "", "", "", "", formatMoney(totalMinor)],
      });
      return pdfResponse(pdf, filename);
    }

    // One column list drives the header, every row and the TOTAL line so the
    // positional CSV can never drift out of alignment.
    const columns = [
      "id",
      "incurredOn",
      "vehicleId",
      "workOrderId",
      "serviceRecordId",
      "category",
      "amountMinor",
      "currency",
      "description",
      "supplier",
      "paidTo",
      "externalReference",
    ];
    const rows = expenses.map((e) => [
      e.id,
      e.incurredOn.toISOString().slice(0, 10),
      e.vehicleId,
      e.workOrderId ?? "",
      e.serviceRecordId ?? "",
      e.category,
      e.amountMinor,
      e.currency,
      e.description,
      e.supplierName ?? "",
      e.paidTo ?? "",
      e.externalReference ?? "",
    ]);
    rows.push(["TOTAL", "", "", "", "", "", totalMinor, "", "", "", "", ""]);

    return csvResponse(buildCsv(columns, rows), filename);
  } catch (error) {
    return toErrorResponse(error);
  }
}
