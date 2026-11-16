import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/api/errors";
import { RATE_LIMITS, enforceRateLimit } from "@/lib/api/rate-limit";
import { requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateRangeLabel, resolveDateRange } from "@/lib/domain/date-range";
import { fuelEntryMatches } from "@/lib/domain/fuel";
import { buildCsv, exportFilename } from "@/lib/export/csv";
import { csvResponse, describeRange, pdfResponse } from "@/lib/export/http";
import { buildExportPdf } from "@/lib/export/pdf";
import { formatDate, formatKm, formatMoney, formatNumber } from "@/lib/format";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { listFuelEntries } from "@/lib/repos/fuel";
import { listVehicles } from "@/lib/repos/vehicles";

export const runtime = "nodejs";

/**
 * GET /api/v1/fuel/export
 * Fuel ledger as CSV or PDF (fuel:export). Carries exactly the filters the
 * page renders (`from`/`to`/`vehicleId`) through the shared `fuelEntryMatches`
 * predicate, so the downloaded file always matches the ledger on screen. The
 * export itself is audited and bounded by the per-user export rate limit.
 * Query: ?format=csv|pdf (default csv), ?from=, ?to=, ?vehicleId=
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.FUEL_EXPORT);
    enforceRateLimit(`export:${context.user.id}`, RATE_LIMITS.export);

    const params = request.nextUrl.searchParams;
    const format = params.get("format") === "pdf" ? "pdf" : "csv";
    const vehicleId = params.get("vehicleId") || undefined;
    const range = resolveDateRange({ from: params.get("from"), to: params.get("to") });

    // Same fetch + same predicate as the fuel page (screen ≡ file).
    const [entries, vehicles] = await Promise.all([
      listFuelEntries({ limit: 2000 }),
      listVehicles(),
    ]);
    const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
    const rows = entries.filter((entry) => fuelEntryMatches(entry, { vehicleId, range }));
    const totalMinor = rows.reduce((sum, entry) => sum + entry.totalMinor, 0);
    const totalLitres = rows.reduce((sum, entry) => sum + (entry.litres ?? 0), 0);
    const litreCount = rows.filter((entry) => typeof entry.litres === "number").length;

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.EXPORT_GENERATED,
      actorId: context.user.id,
      entityType: "fuelEntry",
      reason: `${format} · ${describeRange(range)} · ${rows.length} rows`,
      requestId,
    });

    const filename = exportFilename("fuel", format, range);
    const subtitle = [
      range ? formatDateRangeLabel(range) : "All dates",
      vehicleId ? (vehicleById.get(vehicleId)?.regNumber ?? vehicleId) : "All vehicles",
    ].join(" · ");
    const meta = `Generated ${new Date().toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    })} by ${context.user.email} · ${rows.length} record(s)`;

    if (format === "pdf") {
      const pdf = buildExportPdf({
        title: "Fuel ledger export",
        subtitle,
        meta,
        columns: ["Date", "Vehicle", "Paid to", "Odometer", "Litres", "Total", "Tank"],
        rows: rows.map((entry) => [
          `${formatDate(entry.transactedOn)}${entry.station ? `\n${entry.station}` : ""}`,
          vehicleById.get(entry.vehicleId)?.regNumber ?? "—",
          entry.paidTo ?? "—",
          typeof entry.odometerKm === "number" ? formatKm(entry.odometerKm) : "No reading",
          typeof entry.litres === "number" ? `${formatNumber(entry.litres)} L` : "—",
          formatMoney(entry.totalMinor, entry.currency),
          entry.fullTank ? "Full" : "Partial",
        ]),
        totals: [
          "TOTAL",
          "",
          "",
          "",
          litreCount > 0 ? `${formatNumber(totalLitres)} L` : "",
          formatMoney(totalMinor),
          "",
        ],
      });
      return pdfResponse(pdf, filename);
    }

    // One column list drives the header, every row and the TOTAL line.
    const columns = [
      "date",
      "vehicle",
      "station",
      "paidTo",
      "fuelType",
      "odometerKm",
      "litres",
      "unitPriceMinor",
      "totalMinor",
      "currency",
      "fullTank",
    ];
    const csvRows: (string | number | null)[][] = rows.map((entry) => [
      entry.transactedOn,
      vehicleById.get(entry.vehicleId)?.regNumber ?? entry.vehicleId,
      entry.station ?? "",
      entry.paidTo ?? "",
      entry.fuelType,
      entry.odometerKm ?? "",
      entry.litres ?? "",
      entry.unitPriceMinor ?? "",
      entry.totalMinor,
      entry.currency,
      entry.fullTank ? "yes" : "no",
    ]);
    csvRows.push([
      "TOTAL",
      "",
      "",
      "",
      "",
      "",
      litreCount > 0 ? totalLitres : "",
      "",
      totalMinor,
      "",
      "",
    ]);

    return csvResponse(buildCsv(columns, csvRows), filename);
  } catch (error) {
    return toErrorResponse(error);
  }
}
