import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * Empty state for collections without records. Icon + title + description +
 * optional call-to-action. Use in tables, lists and panels.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 text-center",
        compact ? "py-8" : "py-14",
        className,
      )}
    >
      {Icon && (
        <div className="bg-subtle border-hairline mb-1 flex h-11 w-11 items-center justify-center rounded-full border">
          <Icon aria-hidden="true" className="text-faint h-5 w-5" />
        </div>
      )}
      <h3 className="font-heading text-card-title text-ink font-semibold">{title}</h3>
      {description && <p className="text-body-xs text-muted max-w-sm">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
