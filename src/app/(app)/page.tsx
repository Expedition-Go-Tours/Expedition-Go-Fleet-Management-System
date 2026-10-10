import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Car,
  CheckCircle2,
  ClipboardList,
  Clock3,
  KeyRound,
  ListChecks,
  ReceiptText,
  Route,
  ShieldAlert,
  Wrench,
} from "lucide-react";

import { DashboardHero } from "@/components/dashboard/DashboardHero";
import { BackButton } from "@/components/layout/BackButton";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requireAuthContext } from "@/lib/auth/guards";
import { permissionsForRoles, PERMISSIONS } from "@/lib/auth/permissions";
import { loadControlCentre, type ActionItem } from "@/lib/dashboard/control-centre";
import { formatMoney, formatNumber } from "@/lib/format";

export const metadata = { title: "Fleet control centre" };

const QUEUE_ICON = {
  critical_issue: ShieldAlert,
  safety_hold: ShieldAlert,
  overdue_maintenance: AlertTriangle,
  document: AlertTriangle,
  waiting_work_order: Clock3,
} as const;

export default async function DashboardPage() {
  const context = await requireAuthContext();
  const permissions = [...permissionsForRoles(context.user.roles)];
  const centre = await loadControlCentre({
    userId: context.user.id,
    permissions,
  });

  const canReadVehicles = permissions.includes(PERMISSIONS.VEHICLE_READ);
  const canReadSchedules = permissions.includes(PERMISSIONS.SCHEDULE_READ);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackButton label="Back to previous page" fallbackHref="/" />
      </div>

      <div data-tour="dashboard-overview">
        <DashboardHero
          updatedLabel={new Date(centre.asOf).toLocaleString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          canBrowseFleet={canReadVehicles}
        />
      </div>

      {!canReadVehicles && (
        <Card title="Your workspace" dataTour="dashboard-workspace">
          <div className="flex flex-col gap-4">
            <p className="text-body-sm text-muted">
              You have read access to your own reports. Visit your driver workspace to manage the
              current trip, inspections, and any reported problems.
            </p>
            <div>
              <Link
                href="/workspace"
                className="bg-accent hover:bg-accent-strong inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-medium text-white transition-colors"
              >
                Open driver workspace <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </Card>
      )}

      {centre.fleet && (
        <section aria-label="Fleet overview" data-tour="dashboard-kpis">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <KpiCard
              label="Total vehicles"
              value={formatNumber(centre.fleet.total)}
              href="/vehicles"
              context="Non-archived"
              icon={<Car aria-hidden="true" className="h-4 w-4" />}
            />
            <KpiCard
              label="Available now"
              value={formatNumber(centre.fleet.available)}
              href="/vehicles?availability=available"
              tone={centre.fleet.available > 0 ? "success" : "default"}
              context="Active, unassigned, no critical issue"
              icon={<KeyRound aria-hidden="true" className="h-4 w-4" />}
            />
            <KpiCard
              label="In use"
              value={formatNumber(centre.fleet.inUse)}
              href="/vehicles?availability=in_use"
              context="Active with a current assignment"
              icon={<Route aria-hidden="true" className="h-4 w-4" />}
            />
            <KpiCard
              label="In workshop"
              value={formatNumber(centre.fleet.inWorkshop)}
              href="/vehicles?status=IN_SERVICE"
              tone={centre.fleet.inWorkshop > 0 ? "warning" : "default"}
              context="Out of service for work"
              icon={<Wrench aria-hidden="true" className="h-4 w-4" />}
            />
            <KpiCard
              label="Safety holds"
              value={formatNumber(centre.fleet.safetyHolds)}
              href="/vehicles?status=SAFETY_HOLD"
              tone={centre.fleet.safetyHolds > 0 ? "danger" : "default"}
              context="Barred from service"
              icon={<ShieldAlert aria-hidden="true" className="h-4 w-4" />}
            />
          </div>
        </section>
      )}

      {centre.maintenance && (
        <section aria-label="Maintenance health" data-tour="dashboard-maintenance">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <KpiCard
              label="Overdue tasks"
              value={formatNumber(centre.maintenance.overdue)}
              href="/maintenance?state=OVERDUE"
              tone={centre.maintenance.overdue > 0 ? "danger" : "success"}
              icon={<AlertTriangle aria-hidden="true" className="h-4 w-4" />}
            />
            <KpiCard
              label="Due now"
              value={formatNumber(centre.maintenance.due)}
              href="/maintenance?state=DUE"
              tone={centre.maintenance.due > 0 ? "accent" : "default"}
              icon={<CalendarClock aria-hidden="true" className="h-4 w-4" />}
            />
            <KpiCard
              label="Due soon"
              value={formatNumber(centre.maintenance.dueSoon)}
              href="/maintenance?state=DUE_SOON"
              tone={centre.maintenance.dueSoon > 0 ? "warning" : "default"}
              icon={<Clock3 aria-hidden="true" className="h-4 w-4" />}
            />
            <KpiCard
              label="Open work orders"
              value={formatNumber(centre.maintenance.openWorkOrders)}
              href="/work-orders?open=1"
              context={
                centre.maintenance.waitingWorkOrders > 0
                  ? `${centre.maintenance.waitingWorkOrders} waiting`
                  : "No waiting orders"
              }
              tone={centre.maintenance.waitingWorkOrders > 0 ? "warning" : "default"}
              icon={<Wrench aria-hidden="true" className="h-4 w-4" />}
            />
            <KpiCard
              label="Schedules evaluated"
              value={formatNumber(centre.maintenance.evaluated)}
              context={`${formatNumber(centre.maintenance.notConfigured)} not configured`}
              href="/maintenance"
              icon={<ClipboardList aria-hidden="true" className="h-4 w-4" />}
            />
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section
          aria-label="Priority action queue"
          className="min-w-0 xl:col-span-2"
          data-tour="dashboard-queue"
        >
          <Card
            title="Priority action queue"
            description="What needs attention right now, ordered by risk."
            icon={ListChecks}
            flush
          >
            {centre.queue.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="Nothing needs attention"
                description="No critical issues, safety holds, overdue maintenance or expired mandatory documents right now."
                compact
              />
            ) : (
              <ul className="divide-hairline divide-y">
                {centre.queue.map((item) => (
                  <QueueRow key={item.id} item={item} />
                ))}
              </ul>
            )}
          </Card>
        </section>

        <div className="flex min-w-0 flex-col gap-6">
          {centre.issuesBySeverity && (
            <Card title="Open issues by severity" icon={AlertTriangle} flush>
              {centre.issuesBySeverity.length === 0 ? (
                <p className="text-body-xs text-muted px-5 py-6">No open issues.</p>
              ) : (
                <ul className="divide-hairline divide-y">
                  {centre.issuesBySeverity.map((row) => (
                    <li
                      key={row.severity}
                      className="flex items-center justify-between gap-3 px-5 py-3"
                    >
                      <StatusBadge status={row.severity} />
                      <span className="font-heading text-heading-md text-ink font-semibold tabular-nums">
                        {formatNumber(row.count)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {centre.monthExpenses && (
            <Card
              title="Recorded expenses"
              description="This calendar month (RECORDED only)"
              icon={ReceiptText}
              action={
                <Link
                  href="/expenses"
                  className="text-body-xs text-link font-medium hover:underline"
                >
                  Open ledger
                </Link>
              }
            >
              <div className="flex items-end justify-between gap-4">
                <p className="font-heading text-heading-lg text-ink font-semibold tabular-nums">
                  {formatMoney(centre.monthExpenses.totalMinor)}
                </p>
                <p className="text-body-xs text-muted">
                  {formatNumber(centre.monthExpenses.count)} entr
                  {centre.monthExpenses.count === 1 ? "y" : "ies"}
                </p>
              </div>
            </Card>
          )}

          {canReadSchedules && (
            <Link
              href="/maintenance"
              className="hover:bg-panel-2 group bg-panel-1 text-on-dark flex flex-col gap-2 rounded-lg p-5 transition-colors"
            >
              <span className="font-heading text-card-title font-semibold text-white">
                Maintenance centre
              </span>
              <span className="text-body-xs text-on-dark-muted">
                Fleet-wide preventive maintenance schedules, due dates and history.
              </span>
              <span className="text-body-xs text-accent mt-1 inline-flex items-center gap-1.5 font-medium">
                Open maintenance{" "}
                <ArrowRight
                  aria-hidden="true"
                  className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                />
              </span>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function QueueRow({ item }: { item: ActionItem }) {
  const Icon = QUEUE_ICON[item.kind];
  const toneClasses = {
    danger: "border-error/30 bg-error/10 text-error",
    warning: "border-warning/30 bg-warning/10 text-warning",
    accent: "border-accent/30 bg-accent/10 text-accent",
  }[item.tone];

  return (
    <li>
      <Link
        href={item.href}
        className="hover:bg-subtle flex items-start gap-3 px-5 py-3.5 transition-colors"
      >
        <span
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${toneClasses}`}
        >
          <Icon aria-hidden="true" className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-data text-ink block truncate font-semibold">{item.title}</span>
          <span className="text-data-xs text-muted mt-0.5 block break-words">{item.details}</span>
        </span>
        <ArrowRight aria-hidden="true" className="text-faint mt-2 h-4 w-4 shrink-0" />
      </Link>
    </li>
  );
}
