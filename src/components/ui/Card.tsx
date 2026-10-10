import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

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
  icon: Icon,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  description?: ReactNode;
  /** Optional leading icon beside the title. */
  icon?: LucideIcon;
  /** Trailing actions (buttons, links) on the header row. */
  action?: ReactNode;
  /** Remove default body padding (for tables and full-bleed content). */
  flush?: boolean;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("card-surface overflow-hidden", className)}>
      {(title || description || action) && (
        <header className="border-hairline flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title && (
              <h2 className="text-card-title font-heading text-ink flex items-center gap-2 font-semibold [text-wrap:balance]">
                {Icon && <Icon aria-hidden="true" className="text-faint h-4 w-4 shrink-0" />}
                <span className="truncate">{title}</span>
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
