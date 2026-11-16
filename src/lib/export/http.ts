import type { DateRangeValue } from "@/lib/domain/date-range";

/** Supported download formats for a ledger export. */
export type ExportFormat = "csv" | "pdf" | "json";

/** The page filters an export URL should carry. Absent values are omitted. */
export interface ExportQuery {
  from?: string | null;
  to?: string | null;
  vehicleId?: string | null;
  category?: string | null;
}

/**
 * Build an export URL carrying exactly the filters active on the page, so the
 * download always matches what the user is looking at. Plain anchors — the
 * browser downloads the attachment without any client-side fetch plumbing.
 */
export function exportHref(
  endpoint: string,
  format: ExportFormat,
  query: ExportQuery = {},
): string {
  const params = new URLSearchParams();
  params.set("format", format);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.vehicleId) params.set("vehicleId", query.vehicleId);
  if (query.category) params.set("category", query.category);
  return `${endpoint}?${params.toString()}`;
}

/** CSV attachment response. `no-store` keeps a shared cache from serving one user's data to another. */
export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

/** PDF attachment response. */
export function pdfResponse(bytes: ArrayBuffer, filename: string): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

/** Range label for audit reasons and file metadata: "01 Oct – 18 Oct 2026" or "all dates". */
export function describeRange(range: DateRangeValue | null): string {
  if (!range) return "all dates";
  if (range.from === range.to) return range.from;
  return `${range.from} to ${range.to}`;
}
