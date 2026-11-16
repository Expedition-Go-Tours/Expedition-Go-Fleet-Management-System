import { describe, expect, it } from "vitest";

import { buildExportPdf, sanitizePdfText } from "@/lib/export/pdf";

function asText(buffer: ArrayBuffer): string {
  return new TextDecoder("latin1").decode(new Uint8Array(buffer));
}

describe("sanitizePdfText", () => {
  it("keeps printable ASCII and the Latin-1 supplement", () => {
    expect(sanitizePdfText("GOIL Spintex Road — 12.5 km")).toBe("GOIL Spintex Road — 12.5 km");
    expect(sanitizePdfText("café naïve")).toBe("café naïve");
  });

  it("keeps typographic dashes, quotes and the ellipsis", () => {
    expect(sanitizePdfText("‘quoted’ … done")).toBe("‘quoted’ … done");
  });

  it("replaces characters the built-in fonts cannot draw", () => {
    expect(sanitizePdfText("Twi ɔkwɛ")).toBe("Twi ?kw?");
    expect(sanitizePdfText("thanks 🙏")).toBe("thanks ?");
  });

  it("normalises non-breaking spaces", () => {
    expect(sanitizePdfText("a\u00A0b")).toBe("a b");
  });

  it("keeps newlines so multi-line cells break where the caller intended", () => {
    expect(sanitizePdfText("12 Nov 2026\nGoil Station")).toBe("12 Nov 2026\nGoil Station");
  });
});

describe("buildExportPdf", () => {
  const buffer = buildExportPdf({
    title: "Fuel ledger export",
    subtitle: "12 Oct – 18 Oct 2026 · All vehicles",
    meta: "Generated 16 Nov 2026, 10:30 by ops@example.com · 2 records",
    columns: ["Date", "Vehicle", "Total"],
    rows: [
      ["12 Oct 2026", "GT-1234-26", "GHS 500.00"],
      ["13 Oct 2026", "GT-1234-26", "GHS 620.50"],
    ],
    totals: ["TOTAL", "", "GHS 1,120.50"],
  });

  it("produces a real PDF file", () => {
    const bytes = new Uint8Array(buffer);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
    expect(buffer.byteLength).toBeGreaterThan(1_000);
  });

  it("renders the header, the rows, the TOTAL and the footer", () => {
    const text = asText(buffer);
    expect(text).toContain("Fuel ledger export");
    expect(text).toContain("12 Oct – 18 Oct 2026 · All vehicles");
    expect(text).toContain("ops@example.com");
    expect(text).toContain("GT-1234-26");
    expect(text).toContain("TOTAL");
    expect(text).toContain("internal use only");
    expect(text).toContain("Page 1 of 1");
  });

  it("renders a clear empty state when nothing matches", () => {
    const empty = buildExportPdf({
      title: "Expense ledger export",
      columns: ["Date", "Amount"],
      rows: [],
    });
    const text = asText(empty);
    expect(new Uint8Array(empty).slice(0, 5)).toEqual(new Uint8Array([37, 80, 68, 70, 45]));
    expect(text).toContain("No records match the selected filters.");
  });
});
