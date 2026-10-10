import Link from "next/link";

import { Container } from "@/components/layout/Container";
import { Card } from "@/components/ui/Card";
import { DisplayTitle } from "@/components/ui/DisplayTitle";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requireAuthContext } from "@/lib/auth/guards";
import { PERMISSIONS, rolesHavePermission } from "@/lib/auth/permissions";
import { formatDate, formatKm } from "@/lib/format";
import { listIssues } from "@/lib/repos/reports";
import { listVehicles } from "@/lib/repos/vehicles";
import { listWorkOrders } from "@/lib/repos/work-orders";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const context = await requireAuthContext();
  const canReadAllReports = rolesHavePermission(context.user.roles, PERMISSIONS.REPORT_READ_ALL);
  const canReadWorkOrders = rolesHavePermission(context.user.roles, PERMISSIONS.WORK_ORDER_READ);

  const [vehicles, reports, workOrders] = await Promise.all([
    listVehicles(),
    listIssues(
      canReadAllReports
        ? { status: "OPEN", limit: 50 }
        : { reportedBy: context.user.id, status: "OPEN", limit: 50 },
    ),
    canReadWorkOrders ? listWorkOrders({ status: "IN_PROGRESS", limit: 50 }) : Promise.resolve([]),
  ]);

  const activeVehicles = vehicles.filter((v) => v.status === "ACTIVE");
  const inService = vehicles.filter((v) => v.status === "IN_SERVICE");
  const onHold = vehicles.filter((v) => v.status === "SAFETY_HOLD");

  return (
    <Container className="flex flex-col gap-10 py-10">
      <div className="flex flex-col gap-2">
        <Eyebrow>Fleet overview</Eyebrow>
        <DisplayTitle size="md">Dashboard</DisplayTitle>
      </div>

      {/* Fleet status strip */}
      <div className="border-hairline bg-hairline grid grid-cols-2 gap-px overflow-hidden rounded-xl border md:grid-cols-4">
        <StatCell label="Fleet size" value={String(vehicles.length)} />
        <StatCell label="Active" value={String(activeVehicles.length)} />
        <StatCell label="In service" value={String(inService.length)} />
        <StatCell label="Safety hold" value={String(onHold.length)} highlight={onHold.length > 0} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Open reports */}
        <Card
          title={canReadAllReports ? "Open reports" : "My open reports"}
          action={
            <Link
              href="/reports"
              className="font-ui text-muted hover:text-ink text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase transition-colors"
            >
              View all →
            </Link>
          }
        >
          {reports.length === 0 ? (
            <EmptyRow text="No open reports" />
          ) : (
            <ul className="divide-hairline divide-y">
              {reports.slice(0, 6).map((report) => (
                <li key={report.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-body-sm truncate font-medium">{report.title}</span>
                    <span className="text-body-xs text-muted">{formatDate(report.createdAt)}</span>
                  </div>
                  <StatusBadge status={report.severity} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Active work orders */}
        {canReadWorkOrders && (
          <Card
            title="Work in progress"
            action={
              <Link
                href="/work-orders"
                className="font-ui text-muted hover:text-ink text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase transition-colors"
              >
                View all →
              </Link>
            }
          >
            {workOrders.length === 0 ? (
              <EmptyRow text="No work orders in progress" />
            ) : (
              <ul className="divide-hairline divide-y">
                {workOrders.slice(0, 6).map((wo) => (
                  <li key={wo.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <div className="flex min-w-0 flex-col">
                      <span className="text-body-sm truncate font-medium">{wo.title}</span>
                      <span className="text-body-xs text-muted">
                        {vehicles.find((v) => v.id === wo.vehicleId)?.regNumber ?? "—"} ·{" "}
                        {wo.priority}
                      </span>
                    </div>
                    <StatusBadge status={wo.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {/* Fleet health */}
      {onHold.length > 0 && (
        <Card title="Vehicles on safety hold">
          <ul className="divide-hairline divide-y">
            {onHold.map((vehicle) => (
              <li key={vehicle.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div className="flex min-w-0 flex-col">
                  <Link
                    href={`/vehicles/${vehicle.id}`}
                    className="hover:text-accent text-body-sm truncate font-medium transition-colors"
                  >
                    {vehicle.regNumber} · {vehicle.make} {vehicle.model}
                  </Link>
                  <span className="text-body-xs text-muted">
                    {vehicle.safetyHoldReason ?? "No reason recorded"}
                  </span>
                </div>
                <span className="text-body-xs text-muted">{formatKm(vehicle.odometerKm)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Container>
  );
}

function StatCell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-page flex flex-col gap-1 p-5">
      <Eyebrow>{label}</Eyebrow>
      <span
        className={`font-heading text-display-md font-semibold ${highlight ? "text-accent" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="text-body-xs text-muted px-5 py-6">{text}</p>;
}
