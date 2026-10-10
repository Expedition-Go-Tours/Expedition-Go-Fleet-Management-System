import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * KPI / stat card. Label (sentence case), large value, optional context line
 * and an optional drill-down link to the prefiltered list serving the metric.
 */
export function KpiCard({
  label,
  value,
  context,
  href,
  tone = "default",
  icon,
  className,
}: {
  label: string;
  value: ReactNode;
  context?: ReactNode;
  href?: string;
  /** Semantic emphasis for the value when the metric demands attention. */
  tone?: "default" | "danger" | "warning" | "accent" | "success";
  icon?: ReactNode;
  className?: string;
}) {
  const valueTone = {
    default: "text-ink",
    danger: "text-error",
    warning: "text-warning",
    accent: "text-accent",
    success: "text-success",
  }[tone];

  const inner = (
    <div
      className={cn(
        "card-surface flex flex-col gap-2 p-4 transition-shadow hover:shadow-[0_4px_12px_-2px_rgba(16,24,40,0.1)]",
        href && "group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-body-xs font-medium text-muted">{label}</p>
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      <p className={cn("font-heading text-heading-lg font-semibold tabular-nums", valueTone)}>
        {value}
      </p>
      {context && <p className="text-body-xs text-muted">{context}</p>}
      {href && (
        <span className="text-body-xs mt-auto inline-flex items-center gap-1 font-medium text-link">
          Open list
          <ArrowUpRight
            aria-hidden="true"
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          />
        </span>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block outline-none">
        {inner}
      </Link>
    );
  }
  return inner;
}