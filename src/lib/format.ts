/** Shared display formatting (safe on server and client). */

const CURRENCY_SYMBOLS: Record<string, string> = { GHS: "GH₵", USD: "$", EUR: "€" };

/** Format integer minor units as a decimal amount, e.g. 45500 → "GH₵455.00". */
export function formatMoney(amountMinor: number, currency = "GHS"): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  const major = amountMinor / 100;
  return `${symbol}${major.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "2026-10-09T…Z" → "09 Oct 2026". */
export function formatDate(value: string | Date | undefined | null): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Odometer with thousands separator. */
export function formatKm(km: number): string {
  return `${km.toLocaleString("en-US")} km`;
}
