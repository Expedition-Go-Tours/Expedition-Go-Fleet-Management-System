import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusActions } from "@/components/actions/StatusActions";
import { Container } from "@/components/layout/Container";
import { Card } from "@/components/ui/Card";
import { DisplayTitle } from "@/components/ui/DisplayTitle";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requireAuthContext } from "@/lib/auth/guards";
import { permissionsForRoles } from "@/lib/auth/permissions";
import { VEHICLE_STATUS_ACTIONS } from "@/lib/domain/vehicle";
import { formatDate, formatKm } from "@/lib/format";
import { listReports } from "@/lib/repos/reports";
import { getVehicleById } from "@/lib/repos/vehicles";
import { listWorkOrders } from "@/lib/repos/work-orders";

export const metadata = { title: "Vehicle" };

/**
 * Build the visible action buttons for a vehicle's current status from the
 * server-side action map + the user's permissions — the client can only see
 * (and thus try) actions it is allowed to perform, and the server re-checks.
 */
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
  const [reports, workOrders] = await Promise.all([
    listReports({ vehicleId: vehicle.id, limit: 10 }),
    listWorkOrders({ vehicleId: vehicle.id, limit: 10 }),
  ]);

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
          {formatKm(vehicle.mileage)}
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Recent reports (${reports.length})`}>
          {reports.length === 0 ? (
            <p className="text-body-xs text-muted px-5 py-6">No reports for this vehicle.</p>
          ) : (
            <ul className="divide-hairline divide-y">
              {reports.map((report) => (
                <li key={report.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-body-sm truncate">{report.title}</span>
                    <span className="text-body-xs text-muted">{formatDate(report.createdAt)}</span>
                  </div>
                  <StatusBadge status={report.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Work orders (${workOrders.length})`}>
          {workOrders.length === 0 ? (
            <p className="text-body-xs text-muted px-5 py-6">No work orders for this vehicle.</p>
          ) : (
            <ul className="divide-hairline divide-y">
              {workOrders.map((wo) => (
                <li key={wo.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-body-sm truncate">{wo.title}</span>
                    <span className="text-body-xs text-muted">{wo.priority}</span>
                  </div>
                  <StatusBadge status={wo.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Container>
  );
}
