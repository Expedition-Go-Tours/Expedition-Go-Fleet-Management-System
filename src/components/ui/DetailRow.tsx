import type { ReactNode } from "react";

/**
 * Label-value pair for detail pages. Label sits on the left in uppercase
 * micro-label style; value sits on the right. Includes horizontal padding
 * so it works as a direct child of flush cards.
 */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-2.5">
      <span className="font-ui text-data-xs text-muted font-medium tracking-[var(--tracking-ui)] uppercase">
        {label}
      </span>
      <span className="text-data text-ink text-right">{children}</span>
    </div>
  );
}

/**
 * Compact info strip cell used inside summary strips (e.g. the top-level
 * stats row on a detail page). Two-line: uppercase micro-label + value.
 */
export function StripCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-5 py-4">
      <span className="font-ui text-data-xs text-muted font-medium tracking-[var(--tracking-ui)] uppercase">
        {label}
      </span>
      <span className="text-data text-ink font-medium">{children}</span>
    </div>
  );
}
