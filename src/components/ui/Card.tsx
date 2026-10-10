import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * White surface panel with a sentence-case title header. Use for grouped
 * summaries and focused panels; prefer tables (DataTable) for searchable sets.
 */
export function Card({
  children,
  className,
  title,
  description,
  action,
  bodyClassName,
  flush,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  description?: ReactNode;
  /** Trailing actions (buttons, links) on the header row. */
  action?: ReactNode;
  /** Remove default body padding (for tables and full-bleed content). */
  flush?: boolean;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "card-surface overflow-hidden",
        className,
      )}
    >
      {(title || description || action) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-3.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title && (
              <h2 className="text-card-title font-heading truncate font-semibold text-ink [text-wrap:balance]">
                {title}
              </h2>
            )}
            {description && <p className="text-body-xs text-muted">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={cn(!flush && "p-5", bodyClassName)}>{children}</div>
    </section>
  );
}