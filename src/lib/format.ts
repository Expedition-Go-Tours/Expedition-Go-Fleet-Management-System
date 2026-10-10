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

/** "2026-10-09T…Z" → "09 Oct 2026, 14:32". */
export function formatDateTime(value: string | Date | undefined | null): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** ISO date "2026-10-09" (or Date) → "09 Oct 2026". */
export function formatIsoDate(value: string | Date | undefined | null): string {
  if (!value) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    }
  }
  return formatDate(value);
}

/** Relative age, e.g. "3h ago", "2d ago", "yesterday". */
export function formatRelative(value: Date | string | undefined | null, now = new Date()): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const ms = now.getTime() - date.getTime();
  if (ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** Odometer with thousands separator. */
export function formatKm(km: number): string {
  return `${km.toLocaleString("en-US")} km`;
}

/** Plain thousands separator (no unit). */
export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

/** Day count with singular/plural, e.g. "5 days" / "1 day". */
export function formatDays(days: number): string {
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** Join a list of strings with a middle dot separator. */
export function joinMeta(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" · ");
}