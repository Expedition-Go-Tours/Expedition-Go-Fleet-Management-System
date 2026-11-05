/**
 * Date-range helpers for URL-driven ledger filters.
 *
 * Calendar days are the unit of comparison. Keys are `YYYY-MM-DD` strings so
 * they survive a round trip through the URL without a timezone shifting the
 * day, and every comparison is inclusive of both ends.
 */

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface DateRangeValue {
  /** Inclusive first day, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive last day, `YYYY-MM-DD`. */
  to: string;
}

/** Local calendar day → `YYYY-MM-DD` (never `toISOString()`, which is UTC). */
export function toDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * `YYYY-MM-DD` → local noon. Noon avoids the DST edge where midnight does not
 * exist, and keeps the calendar rendering on the intended day.
 */
export function parseDateKey(key: string | null | undefined): Date | null {
  if (!key || !DATE_KEY_PATTERN.test(key)) return null;
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const day = Number(key.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  // Reject rolled-over values such as 2026-02-31.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/** Extract the local calendar day from a date-only string or a Date. */
export function dateKeyOf(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : toDateKey(value);
  }

  const trimmed = value.trim();
  if (DATE_KEY_PATTERN.test(trimmed)) return trimmed;

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : toDateKey(parsed);
}

/**
 * Normalise URL params into a concrete range.
 *
 * - no valid end → no filter
 * - one valid end → that single day
 * - reversed ends → sorted chronologically
 */
export function resolveDateRange(input: {
  from?: string | null;
  to?: string | null;
}): DateRangeValue | null {
  const fromKey = dateKeyOf(input.from);
  const toKey = dateKeyOf(input.to);

  if (!fromKey && !toKey) return null;

  const start = fromKey ?? toKey!;
  const end = toKey ?? fromKey!;
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

/** True when the value's local calendar day falls inside the inclusive range. */
export function dateInRange(
  value: string | Date | null | undefined,
  range: DateRangeValue,
): boolean {
  const key = dateKeyOf(value);
  if (!key) return false;
  return key >= range.from && key <= range.to;
}

/** Inclusive day count, e.g. 2026-10-01 → 2026-10-03 is 3 days. */
export function daysInRange(range: DateRangeValue): number {
  const from = parseDateKey(range.from);
  const to = parseDateKey(range.to);
  if (!from || !to) return 0;
  const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toUtc - fromUtc) / 86_400_000) + 1;
}

/** "12 Oct 2026" or "12 Oct – 18 Oct 2026" (year only when it differs). */
export function formatDateRangeLabel(range: DateRangeValue): string {
  const from = parseDateKey(range.from);
  const to = parseDateKey(range.to);
  if (!from || !to) return "—";
  if (range.from === range.to) {
    return from.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  const startYear = range.from.slice(0, 4);
  const endYear = range.to.slice(0, 4);
  const start = from.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    ...(startYear === endYear ? {} : { year: "numeric" }),
  });
  const end = to.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return `${start} – ${end}`;
}
