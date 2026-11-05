import { describe, expect, it } from "vitest";

import {
  dateInRange,
  dateKeyOf,
  daysInRange,
  formatDateRangeLabel,
  parseDateKey,
  resolveDateRange,
  toDateKey,
} from "@/lib/domain/date-range";

describe("date keys", () => {
  it("formats a local date without a UTC shift", () => {
    expect(toDateKey(new Date(2026, 0, 1, 23, 30))).toBe("2026-01-01");
    expect(toDateKey(new Date(2026, 11, 31, 0, 15))).toBe("2026-12-31");
  });

  it("parses a calendar key at local noon", () => {
    const date = parseDateKey("2026-10-09");
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(9);
    expect(date?.getDate()).toBe(9);
    expect(date?.getHours()).toBe(12);
  });

  it("rejects impossible keys", () => {
    expect(parseDateKey("2026-02-31")).toBeNull();
    expect(parseDateKey("2026-13-01")).toBeNull();
    expect(parseDateKey("09/10/2026")).toBeNull();
    expect(parseDateKey("")).toBeNull();
  });

  it("keeps a date-only ledger value on its own day", () => {
    expect(dateKeyOf("2026-10-09")).toBe("2026-10-09");
  });

  it("reads the local day from a timestamp", () => {
    expect(dateKeyOf(new Date(2026, 9, 9, 18, 45))).toBe("2026-10-09");
    expect(dateKeyOf(new Date(2026, 9, 9, 0, 1))).toBe("2026-10-09");
  });
});

describe("resolveDateRange", () => {
  it("returns null when neither end is usable", () => {
    expect(resolveDateRange({})).toBeNull();
    expect(resolveDateRange({ from: "nope", to: "" })).toBeNull();
  });

  it("turns a single end into a one-day range", () => {
    expect(resolveDateRange({ from: "2026-10-09" })).toEqual({
      from: "2026-10-09",
      to: "2026-10-09",
    });
    expect(resolveDateRange({ to: "2026-10-09" })).toEqual({
      from: "2026-10-09",
      to: "2026-10-09",
    });
  });

  it("sorts reversed ends chronologically", () => {
    expect(resolveDateRange({ from: "2026-10-18", to: "2026-10-12" })).toEqual({
      from: "2026-10-12",
      to: "2026-10-18",
    });
  });
});

describe("dateInRange", () => {
  const october = { from: "2026-10-01", to: "2026-10-31" };

  it("includes both boundaries", () => {
    expect(dateInRange("2026-10-01", october)).toBe(true);
    expect(dateInRange("2026-10-31", october)).toBe(true);
  });

  it("excludes days outside the range", () => {
    expect(dateInRange("2026-09-30", october)).toBe(false);
    expect(dateInRange("2026-11-01", october)).toBe(false);
  });

  it("compares timestamps by their local calendar day", () => {
    expect(dateInRange(new Date(2026, 9, 31, 23, 59), october)).toBe(true);
    expect(dateInRange(new Date(2026, 10, 1, 0, 0), october)).toBe(false);
  });

  it("rejects unusable values", () => {
    expect(dateInRange("", october)).toBe(false);
    expect(dateInRange("not-a-date", october)).toBe(false);
  });
});

describe("range presentation", () => {
  it("counts both ends", () => {
    expect(daysInRange({ from: "2026-10-01", to: "2026-10-03" })).toBe(3);
    expect(daysInRange({ from: "2026-10-01", to: "2026-10-01" })).toBe(1);
  });

  it("labels a single day once", () => {
    expect(formatDateRangeLabel({ from: "2026-10-09", to: "2026-10-09" })).toBe("09 Oct 2026");
  });

  it("drops the repeated year inside one calendar year", () => {
    expect(formatDateRangeLabel({ from: "2026-10-12", to: "2026-10-18" })).toBe(
      "12 Oct – 18 Oct 2026",
    );
  });

  it("keeps both years when the range crosses new year", () => {
    expect(formatDateRangeLabel({ from: "2025-12-28", to: "2026-01-03" })).toBe(
      "28 Dec 2025 – 03 Jan 2026",
    );
  });
});
