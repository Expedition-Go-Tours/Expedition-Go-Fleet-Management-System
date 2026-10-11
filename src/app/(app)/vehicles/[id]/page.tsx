import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CalendarClock, Gauge, Wrench, type LucideIcon } from "lucide-react";

import { StatusActions } from "@/components/actions/StatusActions";
import { StartAssignmentDialog } from "@/components/assignments/StartAssignmentDialog";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { VehicleHero } from "@/components/vehicles/VehicleHero";
import {
  VehicleDetailTabs,
  type VehicleDetailTabData,
} from "@/components/vehicles/VehicleDetailTabs";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { permissionsForRoles, PERMISSIONS } from "@/lib/auth/permissions";
import { documentState } from "@/lib/domain/document";
import { computeScheduleStatus } from "@/lib/domain/maintenance";
import { VEHICLE_STATUS_ACTIONS } from "@/lib/domain/vehicle";
import { formatDate, formatIsoDate, formatKm, humanizeEnum } from "@/lib/format";
import { countAssignments, listAssignments } from "@/lib/repos/assignments";
import { listDocuments } from "@/lib/repos/documents";
import { countFuelEntries, listFuelEntries } from "@/lib/repos/fuel";
import { listSchedules, listServiceRecords } from "@/lib/repos/maintenance";
import { countReadings, listReadings } from "@/lib/repos/odometers";
import { countIssueTotals, listIssues } from "@/lib/repos/reports";
import { listUsers } from "@/lib/repos/users";
import { listTripsForVehicle } from "@/lib/repos/trips";
import { getVehicleById } from "@/lib/repos/vehicles";
import { countWorkOrderTotals, listWorkOrders } from "@/lib/repos/work-orders";
import type { MaintenanceSchedule } from "@/lib/repos/maintenance";

export const metadata = { title: "Vehicle" };

const EXPIRY_WARNING_DAYS = Number(process.env.DOCUMENT_EXPIRY_WARNING_DAYS ?? 30);

/** Visible action buttons computed from the server-side action map + the user's permissions. */
function visibleActions(status: string, permissions: string[]) {
  const labels: Record<string, string> = {
    send_to_workshop: "Send to workshop",
    return_to_service: "Return to service",
    safety_hold: "Place on safety hold",
    release: "Release from hold",
    archive: "Archive vehicle",
  };
  return Object.entries(VEHICLE_STATUS_ACTIONS)
    .filter(
      ([, def]) =>
        (def.from as readonly string[]).includes(status) && permissions.includes(def.permission),
    )
    .map(([action]) => ({
      action,
      label: labels[action] ?? action,
      variant: action === "release" ? ("accent" as const) : ("outline" as const),
    }));
}

export default async function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePagePermission(PERMISSIONS.VEHICLE_READ);
  const { id } = await params;
  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  const permissions = [...permissionsForRoles(context.user.roles)];
  const actions = visibleActions(vehicle.status, permissions);

  const [
    readings,
    schedules,
    serviceRecords,
    issues,
    workOrders,
    assignments,
    fuelEntries,
    documents,
    users,
    trips,
  ] = await Promise.all([
    listReadings(vehicle.id, { limit: 12 }),
    listSchedules(vehicle.id),
    listServiceRecords(vehicle.id),
    listIssues({ vehicleId: vehicle.id, limit: 10 }),
    listWorkOrders({ vehicleId: vehicle.id, limit: 10 }),
    listAssignments({ vehicleId: vehicle.id, limit: 10 }),
    listFuelEntries({ vehicleId: vehicle.id, limit: 10 }),
    listDocuments(vehicle.id),
    listUsers(),
    listTripsForVehicle(vehicle.id, { status: "COMPLETED", limit: 20 }),
  ]);

  // Accurate totals via Firestore aggregation — independent of the capped
  // "recent slice" lists above, so counts can never be silently truncated.
  const [issueTotals, workOrderTotals, readingCount, assignmentCount, fuelCount] =
    await Promise.all([
      countIssueTotals({ vehicleId: vehicle.id }),
      countWorkOrderTotals({ vehicleId: vehicle.id }),
      countReadings(vehicle.id),
      countAssignments({ vehicleId: vehicle.id }),
      countFuelEntries(vehicle.id),
    ]);

  const userNames = new Map(users.map((u) => [u.id, u.name]));
  const now = new Date();

  // Evaluate every schedule with the REAL intervalDays/dueSoonDays and the
  // Date-typed lastServiceDate — time-based tasks are no longer skipped.
  const evaluatedSchedules = schedules.map((s) => {
    const result = computeScheduleStatus({
      intervalKm: s.intervalKm ?? null,
      intervalDays: s.intervalDays ?? null,
      dueSoonKm: s.dueSoonKm ?? null,
      dueSoonDays: s.dueSoonDays ?? null,
      lastServiceOdometerKm: s.lastServiceOdometerKm ?? null,
      lastServiceDate: s.lastServiceDate ?? null,
      currentOdometerKm: vehicle.odometerKm,
      now,
    });
    return { schedule: s, result };
  });

  const openIssues = issueTotals.open;
  const openWorkOrders = workOrderTotals.open;

  // Staff (assignment:create) may assign an active driver to an available
  // vehicle. The server re-checks reservations, safety hold and permissions;
  // this only decides whether the control is offered at all.
  const canAssign = permissions.includes(PERMISSIONS.ASSIGNMENT_CREATE);
  const hasActiveAssignment = assignments.some((a) => a.status === "ACTIVE");
  const driverOptions = users
    .filter((u) => u.roles.includes("DRIVER") && u.status === "ACTIVE")
    .map((u) => ({ id: u.id, label: `${u.name} · ${u.email}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const canAssignHere =
    canAssign && vehicle.status === "ACTIVE" && !hasActiveAssignment && driverOptions.length > 0;

  const nextService = nextServiceLabel(evaluatedSchedules, vehicle.odometerKm);

  const tabData: VehicleDetailTabData = {
    vehicleId: vehicle.id,
    counts: {
      readings: readingCount,
      issues: issueTotals.total,
      openIssues: issueTotals.open,
      workOrders: workOrderTotals.total,
      openWorkOrders: workOrderTotals.open,
      assignments: assignmentCount,
      fuelEntries: fuelCount,
      documents: documents.length,
      trips: trips.length,
    },
    overview: {
      odometerKm: vehicle.odometerKm,
      odometerAt: formatDate(vehicle.odometerAt),
      createdBy: userNames.get(vehicle.createdBy) ?? vehicle.createdBy,
      createdAt: formatDate(vehicle.createdAt),
      archivedAt: formatDate(vehicle.archivedAt),
      safetyHoldReason: vehicle.safetyHoldReason ?? null,
      safetyHoldAppliedAt: formatDate(vehicle.safetyHoldAppliedAt),
    },
    readings: readings.map((r) => ({
      id: r.id,
      km: r.km,
      source: r.source,
      status: r.status,
      deltaKm: r.deltaKm ?? null,
      effectiveAt: formatDate(r.effectiveAt),
      note: r.notes ?? "",
    })),
    schedules: evaluatedSchedules.map(({ schedule: s, result }) => scheduleToTab(s, result)),
    serviceRecords: serviceRecords.slice(0, 20).map((r) => ({
      id: r.id,
      taskName: r.taskName,
      completedAt: formatDate(r.completedAt),
      odometerKm: r.odometerKm ?? null,
      workOrderId: r.workOrderId ?? null,
      workPerformed: r.workPerformed ?? null,
    })),
    issues: issues.map((i) => ({
      id: i.id,
      number: i.number ?? "",
      title: i.title,
      severity: i.severity,
      status: i.status,
      createdAt: formatDate(i.createdAt),
    })),
    workOrders: workOrders.map((w) => ({
      id: w.id,
      number: w.number ?? "",
      title: w.title,
      priority: w.priority,
      status: w.status,
      createdAt: formatDate(w.createdAt),
    })),
    assignments: assignments.map((a) => ({
      id: a.id,
      driverName: userNames.get(a.driverUserId) ?? a.driverUserId,
      purpose: a.purpose,
      status: a.status,
      startKm: a.startOdometerKm ?? null,
      endKm: a.endOdometerKm ?? null,
      distanceKm: a.distanceKm ?? null,
      createdAt: formatDate(a.createdAt),
    })),
    fuelEntries: fuelEntries.map((f) => ({
      id: f.id,
      transactedOn: formatDate(f.transactedOn),
      litres: f.litres,
      amountMinor: f.totalMinor,
      currency: f.currency,
      odometerKm: f.odometerKm,
      fullTank: f.fullTank,
    })),
    documents: documents.map((d) => ({
      id: d.id,
      category: d.category,
      // Domain-computed state — mandatory-with-upload is no longer MISSSING.
      state: documentState(d, now, EXPIRY_WARNING_DAYS),
      hasFile: Boolean(d.fileKey),
      mandatory: d.mandatory,
      expiryDate: formatIsoDate(d.expiryDate),
      notes: d.notes ?? null,
    })),
    trips: trips.map((t) => ({
      id: t.id,
      tripDate: t.tripDate,
      driverName: userNames.get(t.driverUserId) ?? t.driverUserId,
      purpose: t.purpose,
      externalReference: t.externalReference ?? null,
      originLabel: t.origin.label,
      destinationLabel: t.destination.label,
      stopCount: t.stops.length,
      routeDistanceKm: t.routeDistanceKm ?? null,
      actualDistanceKm: t.actualDistanceKm ?? null,
      distanceBasis: t.distanceBasis,
      status: t.status,
      createdAt: formatDate(t.createdAt),
    })),
  };

  return (
    <div className="flex flex-col gap-6">
      <VehicleHero
        title={vehicle.regNumber}
        description={`${vehicle.make} ${vehicle.model} · ${vehicle.year} · ${humanizeEnum(vehicle.type)}`}
        crumbs={[
          { label: "Fleet" },
          { label: "Vehicles", href: "/vehicles" },
          { label: vehicle.regNumber },
        ]}
        actions={
          <>
            <StatusBadge status={vehicle.status} />
            {canAssignHere && (
              <StartAssignmentDialog
                canAssignOthers
                drivers={driverOptions}
                defaultVehicleId={vehicle.id}
                label="Assign driver"
                variant="outline"
                vehicles={[
                  {
                    id: vehicle.id,
                    label: `${vehicle.regNumber} — ${vehicle.make} ${vehicle.model}`,
                    odometerKm: vehicle.odometerKm,
                  },
                ]}
              />
            )}
            {actions.length > 0 && (
              <StatusActions
                endpoint={`/api/v1/vehicles/${vehicle.id}/status`}
                actions={actions}
                confirm={{
                  archive:
                    "Archive this vehicle? It will be hidden from lists and cannot be resurrected.",
                  safety_hold:
                    "Place this vehicle on safety hold? It will be barred from service until released.",
                }}
                reason={{
                  safety_hold: {
                    label: "Reason for the hold",
                    required: true,
                    placeholder: "Brake failure reported by driver",
                  },
                }}
              />
            )}
          </>
        }
      />

      {/* Summary strip */}
      <Card flush>
        <div className="divide-hairline grid grid-cols-2 divide-x md:grid-cols-4">
          <SummaryCell label="Current odometer" value={formatKm(vehicle.odometerKm)} icon={Gauge} />
          {vehicle.estimatedKm != null && vehicle.estimatedKm > 0 && (
            <SummaryCell
              label="Estimated km"
              value={formatKm(vehicle.estimatedKm)}
              hint={
                vehicle.estimatedKmTripCount
                  ? `${vehicle.estimatedKmTripCount} trips since baseline`
                  : undefined
              }
              icon={Gauge}
            />
          )}
          <SummaryCell
            label="Next service"
            value={nextService.value}
            tone={nextService.tone}
            hint={nextService.hint}
            icon={CalendarClock}
          />
          <LinkCell
            label="Open issues"
            value={String(openIssues)}
            href={`/reports?vehicleId=${vehicle.id}&open=1`}
            icon={AlertTriangle}
          />
          <LinkCell
            label="Open work orders"
            value={String(openWorkOrders)}
            href={`/work-orders?vehicleId=${vehicle.id}&open=1`}
            icon={Wrench}
          />
        </div>
      </Card>

      <VehicleDetailTabs data={tabData} />

      <p className="text-body-xs text-muted">
        Odometer and maintenance figures follow the accepted readings ledger and the documented
        schedule engine. Tabs show the most recent records; a capped list states the true total and
        links to the full register where one exists — counts are never silently truncated.
      </p>
    </div>
  );
}

function scheduleToTab(
  s: MaintenanceSchedule,
  result: ReturnType<typeof computeScheduleStatus>,
): VehicleDetailTabData["schedules"][number] {
  return {
    id: s.id,
    taskName: s.taskName,
    status: result.status,
    category: s.category,
    intervalKm: s.intervalKm ?? null,
    intervalDays: s.intervalDays ?? null,
    enabled: s.enabled,
    lastServiceKm: typeof s.lastServiceOdometerKm === "number" ? s.lastServiceOdometerKm : null,
    lastServiceDate: formatDate(s.lastServiceDate),
    nextDueKm: result.nextDueOdometerKm !== null ? formatKm(result.nextDueOdometerKm) : "—",
    nextDueDate: formatIsoDate(result.nextDueDate),
    remainingKm: result.remainingKm,
    remainingDays: result.remainingDays,
  };
}

function nextServiceLabel(
  evaluated: { schedule: MaintenanceSchedule; result: ReturnType<typeof computeScheduleStatus> }[],
  odometerKm: number,
): { value: string; tone: "default" | "accent" | "warning" | "danger"; hint: string } {
  const rank = { OVERDUE: 0, DUE: 1, DUE_SOON: 2, NOT_CONFIGURED: 3, OK: 4 } as const;
  const sorted = [...evaluated]
    .filter((e) => e.result.status !== "OK")
    .sort((a, b) => rank[a.result.status] - rank[b.result.status]);
  const first = sorted[0];
  if (!first) {
    return { value: "On schedule", tone: "default", hint: "No task due in the configured windows" };
  }
  if (first.result.status === "NOT_CONFIGURED") {
    return {
      value: "Not configured",
      tone: "default",
      hint: "Some tasks lack a baseline or interval",
    };
  }
  const t = first.schedule;
  const r = first.result;
  const remaining =
    r.remainingKm !== null
      ? `${r.remainingKm.toLocaleString()} km`
      : r.remainingDays !== null
        ? `${r.remainingDays} day${r.remainingDays === 1 ? "" : "s"}`
        : null;
  return {
    value: `${t.taskName}`,
    tone: r.status === "OVERDUE" ? "danger" : r.status === "DUE" ? "accent" : "warning",
    hint: remaining
      ? `${r.status === "OVERDUE" ? "Overdue by" : "Due in"} ${remaining} (${formatKm(odometerKm)})`
      : `${r.status} — see Maintenance tab`,
  };
}

function SummaryCell({
  label,
  value,
  tone = "default",
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone?: "default" | "accent" | "warning" | "danger";
  hint?: string;
  icon?: LucideIcon;
}) {
  const toneClasses = {
    default: "text-ink",
    accent: "text-accent",
    warning: "text-warning",
    danger: "text-error",
  }[tone];
  return (
    <div className="flex flex-col gap-0.5 px-5 py-4">
      <span className="font-ui text-data-xs text-muted flex items-center gap-1.5 font-medium tracking-[var(--tracking-ui)] uppercase">
        {Icon && <Icon aria-hidden="true" className="text-faint h-3.5 w-3.5 shrink-0" />}
        {label}
      </span>
      <span className={`font-heading text-heading-md font-semibold tabular-nums ${toneClasses}`}>
        {value}
      </span>
      {hint && <span className="text-data-xs text-muted mt-0.5">{hint}</span>}
    </div>
  );
}

function LinkCell({
  label,
  value,
  href,
  icon: Icon,
}: {
  label: string;
  value: string;
  href: string;
  icon?: LucideIcon;
}) {
  return (
    <Link href={href} className="hover:bg-subtle flex flex-col gap-0.5 px-5 py-4 transition-colors">
      <span className="font-ui text-data-xs text-muted flex items-center gap-1.5 font-medium tracking-[var(--tracking-ui)] uppercase">
        {Icon && <Icon aria-hidden="true" className="text-faint h-3.5 w-3.5 shrink-0" />}
        {label}
      </span>
      <span className="font-heading text-heading-md text-ink font-semibold tabular-nums">
        {value}
      </span>
      <span className="text-data-xs text-link mt-0.5">View records</span>
    </Link>
  );
}
