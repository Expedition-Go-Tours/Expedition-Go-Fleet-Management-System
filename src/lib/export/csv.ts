import type { DateRangeValue } from "@/lib/domain/date-range";

/**
 * Export file building (CSV side).
 *
 * One column list drives the header, every row and the TOTAL line so a
 * positional CSV can never drift out of alignment — the pattern the original
 * expenses export established, now shared by every ledger.
 */

/** RFC 4180 cell: quote when the value contains a comma, quote or newline. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** CSV document: header row + data rows, `\n` separated, no trailing newline. */
export function buildCsv(
  columns: readonly string[],
  rows: readonly (string | number | boolean | null | undefined)[][],
): string {
  return [columns.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join(
    "\n",
  );
}

/**
 * Range-aware download name:
 *   `fuel_2026-10-12_2026-10-18.csv`, `fuel_2026-10-12.csv` (single day),
 *   `fuel_all-dates.csv` (no period chosen).
 */
export function exportFilename(base: string, format: string, range: DateRangeValue | null): string {
  if (!range) return `${base}_all-dates.${format}`;
  if (range.from === range.to) return `${base}_${range.from}.${format}`;
  return `${base}_${range.from}_${range.to}.${format}`;
}
