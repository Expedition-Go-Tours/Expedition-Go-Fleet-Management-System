import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { VoxyVan } from "@/components/brand/VoxyVan";
import type { Crumb } from "@/components/ui/PageHeader";

/**
 * Vehicle profile hero. Charcoal band carrying the breadcrumb trail, the
 * registration title and the vehicle descriptor, with the Voxy van
 * illustration on the right (decorative, hidden below lg). The light strip
 * underneath holds the status badge and lifecycle actions, where the shared
 * light-surface controls keep their intended contrast.
 */
export function VehicleHero({
  title,
  description,
  crumbs,
  actions,
}: {
  title: string;
  description: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
}) {
  return (
    <section className="card-surface overflow-hidden">
      <div className="bg-panel-1 relative">
        <div className="flex flex-col gap-6 px-5 py-6 lg:flex-row lg:items-center lg:justify-between lg:gap-10 lg:px-5 lg:py-8">
          <div className="flex min-w-0 flex-col gap-3">
            {crumbs && crumbs.length > 0 && (
              <nav
                aria-label="Breadcrumb"
                className="text-on-dark-muted flex flex-wrap items-center gap-1.5 text-body-xs"
              >
                {crumbs.map((crumb, index) => (
                  <span key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
                    {index > 0 && <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-on-dark-muted/60" />}
                    {crumb.href ? (
                      <Link href={crumb.href} className="rounded-sm transition-colors hover:text-white">
                        {crumb.label}
                      </Link>
                    ) : (
                      <span aria-current="page" className="font-medium text-white">
                        {crumb.label}
                      </span>
                    )}
                  </span>
                ))}
              </nav>
            )}
            <h1 className="font-heading text-page-title font-semibold tracking-[var(--tracking-heading)] text-white">
              {title}
            </h1>
            <p className="text-body-sm text-on-dark-muted">{description}</p>
          </div>

          <div className="mx-auto w-52 shrink-0 lg:mx-0 lg:hidden">
            <VoxyVan />
          </div>

          <div className="hidden shrink-0 lg:block">
            <VoxyVan className="w-[320px] xl:w-[380px]" />
          </div>
        </div>
      </div>

      {actions && (
        <div className="border-hairline flex flex-wrap items-center gap-2 border-t px-5 py-3">
          {actions}
        </div>
      )}
    </section>
  );
}
