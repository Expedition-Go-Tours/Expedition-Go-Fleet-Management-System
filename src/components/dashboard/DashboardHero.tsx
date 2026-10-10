import Link from "next/link";
import { ArrowRight, RefreshCw } from "lucide-react";

import { VoxyVan } from "@/components/brand/VoxyVan";

/**
 * Dashboard hero band. Left: eyebrow, page title, one-line description and
 * the primary action — all left-aligned to a single edge so nothing drifts.
 * Right: the Voxy van illustration (decorative, hidden below lg).
 * The "updated" chip renders the real control-centre timestamp.
 */
export function DashboardHero({
  updatedLabel,
  canBrowseFleet,
}: {
  /** Real timestamp of the control-centre snapshot ("09:11"). */
  updatedLabel: string;
  canBrowseFleet: boolean;
}) {
  return (
    <section
      aria-label="Fleet control centre"
      className="bg-panel-1 relative overflow-hidden rounded-xl"
    >
      <div className="flex flex-col gap-6 px-4 py-6 lg:flex-row lg:items-center lg:justify-between lg:gap-10 lg:px-4 lg:py-8">
        <div className="flex min-w-0 flex-col gap-3">
          <p className="font-ui text-ui-xs uppercase tracking-[var(--tracking-ui)] text-on-dark-muted">
            Expedition Go Tours · Fleet operations
          </p>
          <h1 className="font-heading text-page-title font-semibold tracking-[var(--tracking-heading)] text-white">
            Fleet control centre
          </h1>
          <p className="text-body-sm max-w-xl text-on-dark-muted">
            Operational status across the fleet, derived live from current records.
          </p>
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            {canBrowseFleet && (
              <Link
                href="/vehicles"
                className="bg-accent hover:bg-accent-strong inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-medium text-white transition-colors"
              >
                Browse fleet <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            )}
            <span className="border-on-dark-line text-on-dark-muted inline-flex h-10 items-center gap-1.5 rounded-md border px-3 font-ui text-ui-xs uppercase tracking-[var(--tracking-ui)]">
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
              Updated {updatedLabel}
            </span>
          </div>
        </div>

        <div className="mx-auto w-56 shrink-0 lg:mx-0 lg:hidden">
          <VoxyVan />
        </div>

        <div className="hidden shrink-0 lg:block">
          <VoxyVan className="w-[360px] xl:w-[420px]" />
        </div>
      </div>
    </section>
  );
}
