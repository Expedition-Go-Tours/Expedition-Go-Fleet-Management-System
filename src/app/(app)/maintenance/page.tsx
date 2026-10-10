import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, Clock3 } from "lucide-react";

import { MaintenanceFilters } from "@/components/maintenance/MaintenanceFilters";
import { Card } from "@/components/ui/Card";
import { CellMeta, DataTable, Td } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { computeScheduleStatus, type ScheduleStatus } from "@/lib/domain/maintenance";
import { formatDate, formatIsoDate, formatKm } from "@/lib/format";
import { listAllSchedules, type MaintenanceSchedule } from "@/lib/repos/maintenance";
import { listVehicles } from "@/lib/repos/vehicles";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";

export const metadata = { title: "Maintenance" };

const STATE_ORDER: ScheduleStatus[] = ["OVERDUE", "DUE", "DUE_SOON", "OK", "NOT_CONFIGURED"];
const STATE_LABELS: Record<string, string> = {
  OVERDUE: "Overdue",
  DUE: "Due",
  DUE_SOON: "Due soon",
  OK: "On schedule",
  NOT_CONFIGURED: "Not configured",
};

interface Row {
  schedule: MaintenanceSchedule;
  status: ScheduleStatus;
  remainingKm: number | null;
  remainingDays: number | null;
  nextDueKm: string | null;
  nextDueDate: string | null;
  vehicleLabel: string;
  vehicleHref: string;
}

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; vehicleId?: string }>;
}) {
  await requirePagePermission(PERMISSIONS.SCHEDULE_READ);
  const { state, vehicleId } = await searchParams;
  const validState = STATE_ORDER.includes(state as ScheduleStatus)
    ? (state as ScheduleStatus)
    : null;

  const [schedules, vehicles] = await Promise.all([listAllSchedules(), listVehicles()]);

  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const vehicleLabels = vehicles
    .slice()
    .sort((a, b) => a.regNumber.localeCompare(b.regNumber))
    .map((v) => ({ id: v.id, label: v.regNumber }));

  const now = new Date();
  const rows: Row[] = schedules.flatMap((schedule) => {
    if (!schedule.enabled) return [];
    const vehicle = vehicleById.get(schedule.vehicleId);
    if (vehicleId && schedule.vehicleId !== vehicleId) return [];
    if (!vehicle) return [];

    const result = computeScheduleStatus({
      intervalKm: schedule.intervalKm ?? null,
      intervalDays: schedule.intervalDays ?? null,
      dueSoonKm: schedule.dueSoonKm ?? null,
      dueSoonDays: schedule.dueSoonDays ?? null,
      lastServiceOdometerKm: schedule.lastServiceOdometerKm ?? null,
      lastServiceDate: schedule.lastServiceDate ?? null,
      currentOdometerKm: vehicle.odometerKm,
      now,
    });

    return [
      {
        schedule,
        status: result.status,
        remainingKm: result.remainingKm,
        remainingDays: result.remainingDays,
        nextDueKm: result.nextDueOdometerKm !== null ? formatKm(result.nextDueOdometerKm) : null,
        nextDueDate: formatIsoDate(result.nextDueDate),
        vehicleLabel: vehicle.regNumber,
        vehicleHref: `/vehicles/${vehicle.id}`,
      },
    ];
  });

  const counts = new Map<ScheduleStatus, number>();
  for (const status of STATE_ORDER) counts.set(status, 0);
  for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);

  const filtered = validState ? rows.filter((row) => row.status === validState) : rows;
  const sorted = filtered.sort((a, b) => {
    const rank = (s: ScheduleStatus) => STATE_ORDER.indexOf(s);
    if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
    return (
      a.vehicleLabel.localeCompare(b.vehicleLabel) ||
      a.schedule.taskName.localeCompare(b.schedule.taskName)
    );
  });

  const onTime = counts.get("OK") ?? 0;
  const totalConfigured =
    (counts.get("OVERDUE") ?? 0) +
    (counts.get("DUE") ?? 0) +
    (counts.get("DUE_SOON") ?? 0) +
    onTime;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Maintenance"
        description="Preventive maintenance across the fleet, computed from the documented schedule engine against accepted odometer readings."
        crumbs={[{ label: "Fleet" }, { label: "Maintenance" }]}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard
          label="Overdue"
          value={counts.get("OVERDUE") ?? 0}
          tone={(counts.get("OVERDUE") ?? 0) > 0 ? "danger" : "default"}
          href="/maintenance?state=OVERDUE"
          context="Past its due point"
          icon={<AlertTriangle aria-hidden="true" className="h-4 w-4" />}
        />
        <KpiCard
          label="Due"
          value={counts.get("DUE") ?? 0}
          tone="accent"
          href="/maintenance?state=DUE"
          context="Needs scheduling now"
          icon={<CalendarClock aria-hidden="true" className="h-4 w-4" />}
        />
        <KpiCard
          label="Due soon"
          value={counts.get("DUE_SOON") ?? 0}
          tone="warning"
          href="/maintenance?state=DUE_SOON"
          context="Inside the warning window"
          icon={<Clock3 aria-hidden="true" className="h-4 w-4" />}
        />
        <KpiCard
          label="On schedule"
          value={onTime}
          tone="success"
          href="/maintenance?state=OK"
          context="Within limits"
          icon={<CheckCircle2 aria-hidden="true" className="h-4 w-4" />}
        />
        <KpiCard
          label="Not configured"
          value={counts.get("NOT_CONFIGURED") ?? 0}
          href="/maintenance?state=NOT_CONFIGURED"
          context="Missing baseline or interval"
          icon={<ClipboardList aria-hidden="true" className="h-4 w-4" />}
        />
      </div>

      <Card
        title="Preventive maintenance board"
        icon={CalendarClock}
        flush
        action={
          <span className="text-body-xs text-muted">
            {totalConfigured > 0
              ? `${onTime} of ${totalConfigured} configured tasks on schedule`
              : "No configured tasks"}
          </span>
        }
      >
        <div className="border-hairline border-b px-4 py-3">
          <MaintenanceFilters vehicles={vehicleLabels} />
        </div>

        <DataTable
          caption="Fleet maintenance schedule states"
          columns={[
            { key: "status", header: "Status" },
            { key: "vehicle", header: "Vehicle" },
            { key: "task", header: "Task" },
            { key: "interval", header: "Interval" },
            { key: "last", header: "Last service" },
            { key: "next", header: "Next due" },
            { key: "remaining", header: "Remaining" },
          ]}
          empty={
            <EmptyState
              icon={CalendarClock}
              title={validState ? STATE_LABELS[validState] : "No maintenance tasks"}
              description={
                validState
                  ? `No tasks are currently ${STATE_LABELS[validState].toLowerCase()}.`
                  : "No preventive maintenance tasks are configured yet."
              }
            />
          }
        >
          {sorted.map((row) => (
            <tr key={row.schedule.id} className="hover:bg-subtle transition-colors">
              <Td>
                <StatusBadge status={row.status} />
              </Td>
              <Td>
                <Link
                  href={row.vehicleHref}
                  className="text-data text-link font-medium hover:underline"
                >
                  {row.vehicleLabel}
                </Link>
              </Td>
              <Td>
                <span className="text-data text-ink font-medium">{row.schedule.taskName}</span>
                <CellMeta className="block">
                  {row.schedule.category.replace(/_/g, " ").toLowerCase()}
                </CellMeta>
              </Td>
              <Td>
                <span className="text-data text-ink">{intervalLabel(row.schedule)}</span>
              </Td>
              <Td>
                <span className="text-data text-ink">
                  {formatDate(row.schedule.lastServiceDate) || "—"}
                </span>
                <CellMeta className="block">
                  {typeof row.schedule.lastServiceOdometerKm === "number"
                    ? `${row.schedule.lastServiceOdometerKm.toLocaleString()} km`
                    : ""}
                </CellMeta>
              </Td>
              <Td>
                <span className="text-data text-ink">
                  {row.nextDueKm ?? row.nextDueDate ?? "—"}
                </span>
              </Td>
              <Td>
                <RemainingCell
                  status={row.status}
                  remainingKm={row.remainingKm}
                  remainingDays={row.remainingDays}
                  lastServiceKm={row.schedule.lastServiceOdometerKm}
                />
              </Td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <p className="text-body-xs text-muted">
        States follow the documented engine: each configured limit is evaluated separately and the
        task takes the worst of them — a task is never “on schedule” while one of its limits is
        overdue. Baselines only move when work is completed through a work order.
      </p>
    </div>
  );
}

function intervalLabel(schedule: MaintenanceSchedule): string {
  const parts: string[] = [];
  if (schedule.intervalKm) parts.push(`${schedule.intervalKm.toLocaleString()} km`);
  if (schedule.intervalDays) parts.push(`${schedule.intervalDays} days`);
  return parts.join(" / ") || "—";
}

function RemainingCell({
  status,
  remainingKm,
  remainingDays,
  lastServiceKm,
}: {
  status: ScheduleStatus;
  remainingKm: number | null;
  remainingDays: number | null;
  lastServiceKm: number | undefined;
}) {
  if (status === "NOT_CONFIGURED") {
    return (
      <CellMeta>{typeof lastServiceKm === "number" ? "Baseline only" : "No baseline set"}</CellMeta>
    );
  }
  if (remainingKm !== null) {
    const overdue = remainingKm < 0;
    return (
      <span className={`text-data tabular-nums ${overdue ? "text-error" : "text-ink"}`}>
        {overdue ? "Overdue by " : ""}
        {Math.abs(remainingKm).toLocaleString()} km
      </span>
    );
  }
  if (remainingDays !== null) {
    const overdue = remainingDays < 0;
    return (
      <span className={`text-data tabular-nums ${overdue ? "text-error" : "text-ink"}`}>
        {overdue ? "Overdue by " : ""}
        {Math.abs(remainingDays)} day{Math.abs(remainingDays) === 1 ? "" : "s"}
      </span>
    );
  }
  return <CellMeta>—</CellMeta>;
}
