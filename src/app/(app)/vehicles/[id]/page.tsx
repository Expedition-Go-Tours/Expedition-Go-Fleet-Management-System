import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusActions } from "@/components/actions/StatusActions";
import { Container } from "@/components/layout/Container";
import { Card } from "@/components/ui/Card";
import { DisplayTitle } from "@/components/ui/DisplayTitle";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  VehicleDetailTabs,
  type VehicleDetailTabData,
} from "@/components/vehicles/VehicleDetailTabs";
import { requireAuthContext } from "@/lib/auth/guards";
import { permissionsForRoles } from "@/lib/auth/permissions";
import { computeScheduleStatus } from "@/lib/domain/maintenance";
import { VEHICLE_STATUS_ACTIONS } from "@/lib/domain/vehicle";
import { formatDate, formatKm } from "@/lib/format";
import { listAssignments } from "@/lib/repos/assignments";
import { listDocuments } from "@/lib/repos/documents";
import { listFuelEntries } from "@/lib/repos/fuel";
import { listSchedules, listServiceRecords } from "@/lib/repos/maintenance";
import { listReadings } from "@/lib/repos/odometers";
import { listIssues } from "@/lib/repos/reports";
import { listUsers } from "@/lib/repos/users";
import { getVehicleById } from "@/lib/repos/vehicles";
import { listWorkOrders } from "@/lib/repos/work-orders";

export const metadata = { title: "Vehicle" };

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
  const context = await requireAuthContext();
  const { id } = await params;
  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  const permissions = [...permissionsForRoles(context.user.roles)];
  const actions = visibleActions(vehicle.status, permissions);

  const [readings, schedules, serviceRecords, issues, workOrders, assignments, fuelEntries, documents, users] =
    await Promise.all([
      listReadings(vehicle.id, { limit: 12 }),
      listSchedules(vehicle.id),
      listServiceRecords(vehicle.id),
      listIssues({ vehicleId: vehicle.id, limit: 10 }),
      listWorkOrders({ vehicleId: vehicle.id, limit: 10 }),
      listAssignments({ vehicleId: vehicle.id, limit: 10 }),
      listFuelEntries({ vehicleId: vehicle.id, limit: 10 }),
      listDocuments(vehicle.id),
      listUsers(),
    ]);

  const driverNames = new Map(users.map((u) => [u.id, u.name]));

  const tabData: VehicleDetailTabData = {
    overview: {
      odometerKm: vehicle.odometerKm,
      odometerAt: formatDate(vehicle.odometerAt),
      createdBy: vehicle.createdBy,
      createdAt: formatDate(vehicle.createdAt),
      archivedAt: formatDate(vehicle.archivedAt),
      safetyHoldReason: vehicle.safetyHoldReason ?? null,
      safetyHoldAppliedAt: formatDate(vehicle.safetyHoldAppliedAt),
    },
    readings: readings.map((r) => ({
      km: r.km,
      source: r.source,
      status: r.status,
      deltaKm: r.deltaKm ?? null,
      effectiveAt: formatDate(r.effectiveAt),
      note: r.notes ?? "",
    })),
    schedules: schedules.map((s) => {
      const status = computeScheduleStatus({
        intervalKm: s.intervalKm ?? null,
        intervalDays: null,
        dueSoonKm: s.dueSoonKm ?? null,
        lastServiceOdometerKm: s.lastServiceOdometerKm ?? null,
        lastServiceDate: s.lastServiceDate ?? null,
        currentOdometerKm: vehicle.odometerKm,
        now: new Date(),
      });
      return {
        taskName: s.taskName,
        status: status.status,
        intervalKm: s.intervalKm ?? null,
        lastServiceKm:
          typeof s.lastServiceOdometerKm === "number" ? s.lastServiceOdometerKm : null,
        lastServiceDate: formatDate(s.lastServiceDate),
        nextDueKm: status.nextDueOdometerKm !== null ? formatKm(status.nextDueOdometerKm) : "—",
      };
    }),
    serviceRecords: serviceRecords.slice(0, 20).map((r) => ({
      taskName: r.taskName,
      completedAt: formatDate(r.completedAt),
      odometerKm: r.odometerKm ?? null,
      workOrderId: r.workOrderId ?? null,
      workPerformed: r.workPerformed ?? null,
    })),
    issues: issues.map((i) => ({
      number: i.number ?? "",
      title: i.title,
      severity: i.severity,
      status: i.status,
      createdAt: formatDate(i.createdAt),
    })),
    workOrders: workOrders.map((w) => ({
      number: w.number ?? "",
      title: w.title,
      priority: w.priority,
      status: w.status,
      createdAt: formatDate(w.createdAt),
    })),
    assignments: assignments.map((a) => ({
      driverName: driverNames.get(a.driverUserId) ?? a.driverUserId,
      purpose: a.purpose,
      status: a.status,
      startKm: a.startOdometerKm ?? null,
      endKm: a.endOdometerKm ?? null,
      distanceKm: a.distanceKm ?? null,
      createdAt: formatDate(a.createdAt),
    })),
    fuelEntries: fuelEntries.map((f) => ({
      transactedOn: f.transactedOn,
      litres: f.litres,
      amountMinor: f.totalMinor,
      odometerKm: f.odometerKm,
    })),
    documents: documents.map((d) => ({
      category: d.category,
      status: d.mandatory || !d.expiryDate ? "MISSING" : "VALID",
      expiryDate: d.expiryDate ?? "",
      mandatory: d.mandatory,
      notes: d.notes ?? null,
    })),
  };

  return (
    <Container className="flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-2">
        <Link
          href="/vehicles"
          className="font-ui text-muted hover:text-ink text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase transition-colors"
        >
          ← Vehicles
        </Link>
        <div className="flex flex-wrap items-center gap-4">
          <DisplayTitle size="md">{vehicle.regNumber}</DisplayTitle>
          <StatusBadge status={vehicle.status} />
        </div>
        <p className="text-body-sm text-muted">
          {vehicle.make} {vehicle.model} · {vehicle.year} · {vehicle.type} ·{" "}
          {formatKm(vehicle.odometerKm)}
        </p>
      </div>

      {actions.length > 0 && (
        <Card title="Status actions">
          <div className="p-5">
            <StatusActions
              endpoint={`/api/v1/vehicles/${vehicle.id}/status`}
              actions={actions}
              confirm={{
                archive:
                  "Archive this vehicle? It will be hidden from lists and cannot be resurrected.",
                safety_hold: "Place this vehicle on safety hold?",
              }}
            />
          </div>
        </Card>
      )}

      <VehicleDetailTabs data={tabData} />
    </Container>
  );
}