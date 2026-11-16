import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/api/errors";
import { RATE_LIMITS, enforceRateLimit } from "@/lib/api/rate-limit";
import { requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateRangeLabel, resolveDateRange } from "@/lib/domain/date-range";
import { serviceRecordMatchesFilters } from "@/lib/domain/maintenance";
import { buildCsv, exportFilename } from "@/lib/export/csv";
import { csvResponse, describeRange, pdfResponse } from "@/lib/export/http";
import { buildExportPdf } from "@/lib/export/pdf";
import { formatDate, formatKm, formatMoney } from "@/lib/format";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { listRecentServiceRecords } from "@/lib/repos/maintenance";
import { listVehicles } from "@/lib/repos/vehicles";

export const runtime = "nodejs";

/**
 * GET /api/v1/service-records/export
 * Completed service records as CSV or PDF (service:export) — the same records
 * the maintenance page's "Completed service records" card shows, carrying the
 * same `from`/`to`/`vehicleId` filters through the shared
 * `serviceRecordMatchesFilters` predicate. The preventive board is a live
 * status view and is deliberately not exported. Audited; rate limited.
 * Query: ?format=csv|pdf (default csv), ?from=, ?to=, ?vehicleId=
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.SERVICE_EXPORT);
    enforceRateLimit(`export:${context.user.id}`, RATE_LIMITS.export);

    const params = request.nextUrl.searchParams;
    const format = params.get("format") === "pdf" ? "pdf" : "csv";
    const vehicleId = params.get("vehicleId") || undefined;
    const range = resolveDateRange({ from: params.get("from"), to: params.get("to") });

    // Same fetch + same predicate as the maintenance page (screen ≡ file).
    const [records, vehicles] = await Promise.all([listRecentServiceRecords(1000), listVehicles()]);
    const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
    const rows = records.filter((record) =>
      serviceRecordMatchesFilters(record, { vehicleId, range }),
    );

    // Only report a cost total when every priced record shares one currency —
    // an across-currency sum would be fiction.
    const priced = rows.filter((record) => typeof record.repairCostMinor === "number");
    const currencies = new Set(priced.map((record) => record.repairCostCurrency ?? "GHS"));
    const totalCost =
      currencies.size === 1
        ? priced.reduce((sum, record) => sum + (record.repairCostMinor ?? 0), 0)
        : null;

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.EXPORT_GENERATED,
      actorId: context.user.id,
      entityType: "serviceRecord",
      reason: `${format} · ${describeRange(range)} · ${rows.length} rows`,
      requestId,
    });

    const filename = exportFilename("service-records", format, range);
    const subtitle = [
      range ? formatDateRangeLabel(range) : "All dates",
      vehicleId ? (vehicleById.get(vehicleId)?.regNumber ?? vehicleId) : "All vehicles",
    ].join(" · ");
    const meta = `Generated ${new Date().toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    })} by ${context.user.email} · ${rows.length} record(s)`;

    if (format === "pdf") {
      // The PDF mirrors the on-screen table's columns; the CSV below carries
      // the fuller record (work performed, provider, technician, ids).
      const pdf = buildExportPdf({
        title: "Completed service records",
        subtitle,
        meta,
        columns: ["Completed", "Vehicle", "Task", "Odometer", "Cost", "Paid to", "Source"],
        rows: rows.map((record) => [
          `${formatDate(record.completedAt)}${record.providerName ? `\n${record.providerName}` : ""}`,
          vehicleById.get(record.vehicleId)?.regNumber ?? "—",
          record.taskName,
          record.odometerKm !== null ? formatKm(record.odometerKm) : "No reading",
          typeof record.repairCostMinor === "number"
            ? formatMoney(record.repairCostMinor, record.repairCostCurrency ?? "GHS")
            : "—",
          record.paidTo ?? "—",
          record.workOrderId ? "Work order" : "Direct log",
        ]),
        ...(totalCost !== null
          ? { totals: ["TOTAL", "", "", "", formatMoney(totalCost), "", ""] }
          : {}),
      });
      return pdfResponse(pdf, filename);
    }

    const columns = [
      "completedAt",
      "vehicle",
      "taskName",
      "workPerformed",
      "providerName",
      "technicianName",
      "odometerKm",
      "repairCostMinor",
      "repairCostCurrency",
      "paidTo",
      "source",
      "workOrderId",
    ];
    const csvRows: (string | number | null)[][] = rows.map((record) => [
      record.completedAt.toISOString().slice(0, 10),
      vehicleById.get(record.vehicleId)?.regNumber ?? record.vehicleId,
      record.taskName,
      record.workPerformed,
      record.providerName ?? "",
      record.technicianName ?? "",
      record.odometerKm ?? "",
      record.repairCostMinor ?? "",
      record.repairCostCurrency ?? "",
      record.paidTo ?? "",
      record.workOrderId ? "work order" : "direct log",
      record.workOrderId ?? "",
    ]);
    if (totalCost !== null) {
      csvRows.push([
        "TOTAL",
        "",
        "",
        "",
        "",
        "",
        "",
        totalCost,
        currencies.values().next().value ?? "GHS",
        "",
        "",
        "",
      ]);
    }

    return csvResponse(buildCsv(columns, csvRows), filename);
  } catch (error) {
    return toErrorResponse(error);
  }
}
