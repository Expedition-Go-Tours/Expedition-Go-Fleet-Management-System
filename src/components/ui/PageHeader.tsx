import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Standard page header: breadcrumb trail, 28px title, description and
 * trailing actions. Every application page uses this for a consistent grid.
 */
export function PageHeader({
  title,
  description,
  crumbs,
  actions,
  className,
  dataTour,
}: {
  title: string;
  description?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
  className?: string;
  /** Stable `data-tour` hook targeted by the guided tours. */
  dataTour?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)} data-tour={dataTour}>
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="text-body-xs text-muted flex items-center gap-1.5">
          {crumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
              {index > 0 && <ChevronRight aria-hidden="true" className="text-faint h-3.5 w-3.5" />}
              {crumb.href ? (
                <Link href={crumb.href} className="hover:text-ink rounded-sm transition-colors">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current="page" className="text-ink font-medium">
                  {crumb.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-heading text-page-title text-ink font-semibold tracking-[var(--tracking-heading)]">
            {title}
          </h1>
          {description && <p className="text-body-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
