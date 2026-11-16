import { describe, expect, it } from "vitest";

import { buildCsv, csvCell, exportFilename } from "@/lib/export/csv";

describe("csvCell (RFC 4180)", () => {
  it("passes plain values through untouched", () => {
    expect(csvCell("GOIL Spintex")).toBe("GOIL Spintex");
    expect(csvCell(500_00)).toBe("50000");
    expect(csvCell(true)).toBe("true");
  });

  it("quotes values containing commas, quotes or newlines", () => {
    expect(csvCell("Accra, Central")).toBe('"Accra, Central"');
    expect(csvCell('He said "full"')).toBe('"He said ""full"""');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("renders empty values as empty fields", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("")).toBe("");
  });
});

describe("buildCsv", () => {
  it("drives the header and every row from one column list", () => {
    const csv = buildCsv(
      ["date", "total"],
      [
        ["2026-10-12", 500_00],
        ["2026-10-13", "Free, promo"],
      ],
    );
    expect(csv).toBe('date,total\n2026-10-12,50000\n2026-10-13,"Free, promo"');
  });

  it("keeps a TOTAL row positionally aligned", () => {
    const columns = ["id", "amountMinor", "note"];
    const csv = buildCsv(columns, [
      ["exp_1", 100, ""],
      ["TOTAL", 100, ""],
    ]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("TOTAL,100,");
    // Every line has exactly as many fields as the column list.
    for (const line of lines) {
      expect(line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)).toHaveLength(columns.length);
    }
  });
});

describe("exportFilename", () => {
  it("encodes both ends of a range", () => {
    expect(exportFilename("fuel", "csv", { from: "2026-10-12", to: "2026-10-18" })).toBe(
      "fuel_2026-10-12_2026-10-18.csv",
    );
  });

  it("encodes a single day once", () => {
    expect(exportFilename("expenses", "pdf", { from: "2026-10-12", to: "2026-10-12" })).toBe(
      "expenses_2026-10-12.pdf",
    );
  });

  it("marks an unfiltered export", () => {
    expect(exportFilename("service-records", "csv", null)).toBe("service-records_all-dates.csv");
  });
});
