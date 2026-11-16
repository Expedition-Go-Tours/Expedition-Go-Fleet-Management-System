import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

/**
 * Server-side PDF export for ledger records (A4 landscape).
 *
 * Generated in the route handler like CSV — same auth, same audit, same
 * filename rules — so a download needs no client-side fetch plumbing. The
 * built-in Helvetica fonts only cover the WinAnsi repertoire, so every string
 * is passed through `sanitizePdfText` first: unknown characters become `?`
 * instead of corrupting the file.
 *
 * Brand colours mirror `tokens.css` (ink / subtle / accent) so the document
 * reads as part of the product rather than a generic table dump.
 */

const INK: [number, number, number] = [26, 29, 33]; // --c-ink
const SUBTLE: [number, number, number] = [250, 250, 249]; // --bg-subtle
const HAIRLINE: [number, number, number] = [226, 227, 228]; // --border-hairline, solid
const MUTED: [number, number, number] = [115, 120, 128]; // --text-muted
const ACCENT: [number, number, number] = [241, 90, 36]; // --c-accent
const WHITE: [number, number, number] = [255, 255, 255];

/**
 * Keep text renderable by the built-in WinAnsi fonts: printable ASCII, the
 * Latin-1 supplement, newlines (autotable line-breaks on them), and the
 * typographic marks (dashes, quotes, ellipsis, euro) Windows-1252 actually
 * defines. NBSP becomes a plain space; anything else — emoji, Twi characters,
 * CJK — becomes `?`.
 */
export function sanitizePdfText(value: string): string {
  return value
    .replace(/\u00A0/g, " ")
    .replace(
      /[^\n\r\u0020-\u007E\u00A1-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u2020\u2021\u2030\u20AC]/gu,
      "?",
    );
}

export interface ExportPdfInput {
  /** Page title, e.g. "Fuel ledger export". */
  title: string;
  /** Active filters, e.g. "01 Oct – 18 Oct 2026 · Toyota GT-1234". */
  subtitle?: string;
  /** Provenance line: generated-on, user, row count. */
  meta?: string;
  columns: readonly string[];
  /** Pre-formatted display strings, one array per record. */
  rows: readonly (readonly string[])[];
  /** Optional TOTAL row, positionally aligned with `columns`. */
  totals?: readonly string[];
}

const MARGIN_MM = 12;
const HEADER_BOTTOM_MM = 30;

/** A4 landscape report: header block, themed table with repeated head, page footers. */
export function buildExportPdf(input: ExportPdfInput): ArrayBuffer {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: false });

  const title = sanitizePdfText(input.title);
  const subtitle = input.subtitle ? sanitizePdfText(input.subtitle) : undefined;
  const meta = input.meta ? sanitizePdfText(input.meta) : undefined;

  doc.setProperties({
    title: `${title}`,
    subject: subtitle ?? title,
    creator: "Expedition Go Tours",
  });

  const pageWidth = doc.internal.pageSize.getWidth();

  // Header block (first page).
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text(title, MARGIN_MM, 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  if (subtitle) doc.text(subtitle, MARGIN_MM, 22);
  if (meta) {
    doc.setFontSize(8);
    doc.text(meta, MARGIN_MM, 27);
  }

  // Brand accent rule under the header.
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(0.6);
  doc.line(MARGIN_MM, HEADER_BOTTOM_MM - 0.5, pageWidth - MARGIN_MM, HEADER_BOTTOM_MM - 0.5);

  const sanitizedColumns = input.columns.map(sanitizePdfText);
  const body =
    input.rows.length > 0
      ? input.rows.map((row) => row.map(sanitizePdfText))
      : [
          [
            {
              content: "No records match the selected filters.",
              colSpan: sanitizedColumns.length,
              styles: { halign: "center", fontStyle: "italic" } as const,
            },
          ],
        ];

  autoTable(doc, {
    head: [sanitizedColumns],
    body,
    ...(input.totals ? { foot: [input.totals.map(sanitizePdfText)] } : {}),
    startY: HEADER_BOTTOM_MM + 3,
    theme: "grid",
    margin: { top: HEADER_BOTTOM_MM + 3, right: MARGIN_MM, bottom: 16, left: MARGIN_MM },
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 2.2,
      overflow: "linebreak",
      textColor: INK,
      lineColor: HAIRLINE,
      lineWidth: 0.1,
      valign: "middle",
    },
    headStyles: {
      fillColor: INK,
      textColor: WHITE,
      fontStyle: "bold",
    },
    footStyles: {
      fillColor: SUBTLE,
      textColor: INK,
      fontStyle: "bold",
    },
    alternateRowStyles: {
      fillColor: SUBTLE,
    },
  });

  // Footer stamp on every page: provenance left, page number right.
  const totalPages = doc.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text("Expedition Go Tours — internal use only", MARGIN_MM, pageHeight - 7);
    doc.text(`Page ${page} of ${totalPages}`, pageWidth - MARGIN_MM, pageHeight - 7, {
      align: "right",
    });
  }

  return doc.output("arraybuffer");
}
