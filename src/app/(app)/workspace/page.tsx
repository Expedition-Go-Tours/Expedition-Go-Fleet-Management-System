import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Megaphone,
  Route,
  ShieldAlert,
  ShieldPlus,
} from "lucide-react";

import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EndAssignmentButton } from "@/components/workspace/EndAssignmentButton";
import { InspectionDialog } from "@/components/workspace/InspectionDialog";
import {
  NotificationList,
  type WorkspaceNotification,
} from "@/components/workspace/NotificationList";
import { ReportIncidentDialog } from "@/components/workspace/ReportIncidentDialog";
import { ReportProblemDialog } from "@/components/workspace/ReportProblemDialog";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS, permissionsForRoles } from "@/lib/auth/permissions";
import { defaultChecklist } from "@/lib/domain/inspection";
import { formatDate, formatKm } from "@/lib/format";
import { getActiveAssignmentForDriver } from "@/lib/repos/assignments";
import { listIncidents, countIncidents } from "@/lib/repos/incidents";
import { listInspections } from "@/lib/repos/inspections";
import { listNotifications } from "@/lib/repos/notifications";
import { countIssueTotals, listIssues } from "@/lib/repos/reports";
import { listVehicles } from "@/lib/repos/vehicles";

export const metadata = { title: "Driver workspace" };

/**
 * Driver-facing workspace (mobile-first): active trip with end-odometer,
 * pre-trip/return inspections, problem + incident reporting, recent records
 * and notifications. Every mutation goes through the /api/v1 endpoints so
 * the odometer ledger, safety-hold, evidence and read-realm logic stay on
 * the server.
 */
export default async function WorkspacePage() {
  const context = await requirePagePermission([
    PERMISSIONS.ASSIGNMENT_READ,
    PERMISSIONS.REPORT_CREATE,
    PERMISSIONS.INSPECTION_SUBMIT,
  ]);
  const permissions = [...permissionsForRoles(context.user.roles)];
  const canCreateReport = permissions.includes(PERMISSIONS.REPORT_CREATE);
  const canCreateIncident = permissions.includes(PERMISSIONS.INCIDENT_CREATE);
  const canSubmitInspections = permissions.includes(PERMISSIONS.INSPECTION_SUBMIT);

  const assignment = await getActiveAssignmentForDriver(context.user.id);

  const [
    issues,
    issueTotals,
    incidents,
    incidentTotal,
    vehicles,
    notificationsByRole,
    myInspections,
    assignmentInspections,
  ] = await Promise.all([
    listIssues({ reportedBy: context.user.id, limit: 10 }),
    countIssueTotals({ reportedBy: context.user.id }),
    listIncidents({ reportedBy: context.user.id, limit: 10 }),
    countIncidents({ reportedBy: context.user.id }),
    listVehicles(),
    Promise.all(
      context.user.roles.map((role) => listNotifications({ recipientRole: role, limit: 500 })),
    ),
    listInspections({ inspectorUserId: context.user.id, limit: 8 }),
    // Today's inspections on the assigned vehicle decide the "submitted" state.
    assignment
      ? listInspections({
          vehicleId: assignment.vehicleId,
          inspectorUserId: context.user.id,
          limit: 100,
        })
      : Promise.resolve([]),
  ]);

  const vehicle = assignment ? (vehicles.find((v) => v.id === assignment.vehicleId) ?? null) : null;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayForVehicle = assignmentInspections.filter(
    (i) => i.submittedAt.getTime() >= startOfToday.getTime(),
  );
  const preTripSubmitted = todayForVehicle.some((i) => i.type === "PRE_TRIP");
  const returnSubmitted = todayForVehicle.some((i) => i.type === "RETURN");

  const vehicleOptions = vehicles
    .slice()
    .sort((a, b) => a.regNumber.localeCompare(b.regNumber))
    .map((v) => ({ id: v.id, label: `${v.regNumber} — ${v.make} ${v.model}` }));

  const checklist = defaultChecklist().map((item) => ({
    key: item.key,
    label: item.label,
    critical: item.critical,
  }));

  const merged = new Map<string, (typeof notificationsByRole)[number][number]>();
  for (const list of notificationsByRole) for (const n of list) merged.set(n.id, n);
  const notifications: WorkspaceNotification[] = [...merged.values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 8)
    .map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      type: n.type,
      createdAt: formatDate(n.createdAt),
      read: Boolean(n.readAt),
    }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Driver workspace"
        description="Your trip, inspections and reports — everything on the record is written through the fleet API."
        crumbs={[{ label: "Overview" }, { label: "Driver workspace" }]}
      />

      {/* Active trip */}
      <Card title={assignment ? "Active trip" : "No active trip"} icon={Route}>
        <div className="p-5">
          {assignment && vehicle ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/vehicles/${vehicle.id}`}
                  className="text-body-sm text-link font-semibold hover:underline"
                >
                  {vehicle.regNumber} — {vehicle.make} {vehicle.model}
                </Link>
                <StatusBadge status={assignment.status} />
                <span className="font-ui text-muted ml-auto text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
                  {assignment.purpose.replace(/_/g, " ")}
                </span>
              </div>
              <p className="text-body-xs text-muted">
                Started {formatDate(assignment.startedAt)} at{" "}
                {formatKm(assignment.startOdometerKm ?? 0)} — current reading{" "}
                {formatKm(vehicle.odometerKm)}.
              </p>

              {vehicle.status === "SAFETY_HOLD" && (
                <div className="border-error/30 bg-error/10 text-error flex items-start gap-2 rounded-md border p-3">
                  <ShieldAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="text-body-xs">
                    This vehicle is on safety hold. It must not be driven until maintenance releases
                    the hold — report the situation to operations before leaving the depot.
                  </p>
                </div>
              )}

              <EndAssignmentButton
                assignmentId={assignment.id}
                minKm={assignment.startOdometerKm ?? 0}
                vehicleLabel={vehicle.regNumber}
              />
            </div>
          ) : assignment ? (
            <div className="flex flex-col gap-2 py-2">
              <p className="text-body-xs text-muted">
                Assigned vehicle not found — contact operations.
              </p>
              <p className="font-ui text-muted text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
                Assignment {assignment.id}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 py-2">
              <p className="text-body-sm text-ink">You have no assigned trip.</p>
              <p className="text-body-xs text-muted">
                Contact operations to be assigned a vehicle. Inspections and end-of-trip readings
                can only be submitted against an active assignment.
              </p>
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* Inspections */}
          {canSubmitInspections && vehicle && (
            <Card
              title="Vehicle inspections"
              icon={ClipboardCheck}
              action={
                <span className="text-body-xs text-muted">
                  Odometer goes through the accepted-reading ledger
                </span>
              }
            >
              <div className="flex flex-col gap-4 p-5">
                <p className="text-body-xs text-muted">
                  Run the pre-trip check before departure and the return check once the trip ends.
                  Failed critical items raise linked issues and a safety hold — that cannot be
                  undone from the workspace.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {preTripSubmitted ? (
                    <span className="text-success border-success/25 bg-success/10 text-body-xs inline-flex items-center gap-1.5 rounded-md border px-3 py-2 font-medium">
                      <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                      Pre-trip submitted today
                    </span>
                  ) : (
                    <InspectionDialog
                      vehicleId={vehicle.id}
                      vehicleLabel={vehicle.regNumber}
                      type="PRE_TRIP"
                      assignmentId={assignment?.id}
                      currentOdometerKm={vehicle.odometerKm}
                      checklist={checklist}
                    />
                  )}
                  {returnSubmitted ? (
                    <span className="text-success border-success/25 bg-success/10 text-body-xs inline-flex items-center gap-1.5 rounded-md border px-3 py-2 font-medium">
                      <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                      Return submitted today
                    </span>
                  ) : (
                    <InspectionDialog
                      vehicleId={vehicle.id}
                      vehicleLabel={vehicle.regNumber}
                      type="RETURN"
                      assignmentId={assignment?.id}
                      currentOdometerKm={vehicle.odometerKm}
                      checklist={checklist}
                    />
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* My issues */}
          <Card
            title={`My reported issues (${issueTotals.total})${
              issues.length < issueTotals.total ? ` · showing ${issues.length}` : ""
            }`}
            icon={AlertTriangle}
          >
            {issues.length === 0 ? (
              <p className="text-body-xs text-muted px-5 py-6">You have not reported any issues.</p>
            ) : (
              <ul className="divide-hairline divide-y">
                {issues.map((issue) => {
                  const v = vehicles.find((x) => x.id === issue.vehicleId);
                  return (
                    <li key={issue.id}>
                      <Link
                        href={`/reports/${issue.id}`}
                        className="hover:bg-subtle flex items-start justify-between gap-3 px-5 py-3 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-body-sm text-ink font-medium">
                            {issue.number ? `${issue.number} — ` : ""}
                            {issue.title}
                          </p>
                          <p className="text-body-xs text-muted mt-0.5">
                            {v ? v.regNumber : "—"} · {issue.severity} ·{" "}
                            {formatDate(issue.createdAt)}
                          </p>
                        </div>
                        <StatusBadge status={issue.status} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* My incidents */}
          <Card
            title={`My incident reports (${incidentTotal})${
              incidents.length < incidentTotal ? ` · showing ${incidents.length}` : ""
            }`}
            icon={ShieldPlus}
          >
            {incidents.length === 0 ? (
              <p className="text-body-xs text-muted px-5 py-6">
                You have not reported any incidents.
              </p>
            ) : (
              <ul className="divide-hairline divide-y">
                {incidents.map((incident) => {
                  const v = vehicles.find((x) => x.id === incident.vehicleId);
                  return (
                    <li key={incident.id}>
                      <Link
                        href={`/incidents/${incident.id}`}
                        className="hover:bg-subtle flex items-start justify-between gap-3 px-5 py-3 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-body-sm text-ink font-medium">
                            {incident.type.replace(/_/g, " ").toLowerCase()} — {incident.severity}
                          </p>
                          <p className="text-body-xs text-muted mt-0.5">
                            {v ? v.regNumber : "—"} · {formatDate(incident.occurredAt)}
                            {incident.location ? ` · ${incident.location}` : ""}
                          </p>
                        </div>
                        <StatusBadge status={incident.status} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Recent inspections */}
          {canSubmitInspections && myInspections.length > 0 && (
            <Card title="Recent inspections" icon={ClipboardList}>
              <ul className="divide-hairline divide-y">
                {myInspections.map((inspection) => (
                  <li
                    key={inspection.id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-body-sm text-ink font-medium">
                        {inspection.type === "PRE_TRIP" ? "Pre-trip" : "Return"} ·{" "}
                        {formatDate(inspection.submittedAt)}
                      </p>
                      <p className="text-body-xs text-muted mt-0.5">
                        {formatKm(inspection.odometerKm)} —{" "}
                        {inspection.issueIds.length > 0
                          ? `${inspection.issueIds.length} linked issue${inspection.issueIds.length === 1 ? "" : "s"}`
                          : "No linked issues"}
                      </p>
                    </div>
                    <StatusBadge
                      status={inspection.overall === "NOT_APPLICABLE" ? "NA" : inspection.overall}
                    />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          {/* Report actions */}
          {(canCreateReport || canCreateIncident) && (
            <Card title="Report" icon={Megaphone}>
              <div className="flex flex-wrap gap-2 p-5">
                {canCreateReport && (
                  <ReportProblemDialog vehicles={vehicleOptions} defaultVehicleId={vehicle?.id} />
                )}
                {canCreateIncident && (
                  <ReportIncidentDialog vehicles={vehicleOptions} defaultVehicleId={vehicle?.id} />
                )}
              </div>
            </Card>
          )}

          {/* Notifications */}
          <Card
            title="Notifications"
            icon={Bell}
            action={
              <Link
                href="/notifications"
                className="text-body-xs text-link font-medium hover:underline"
              >
                View all
              </Link>
            }
          >
            <NotificationList notifications={notifications} />
          </Card>
        </div>
      </div>

      <p className="text-body-xs text-muted">
        These lists show your own records only — the full issue, work-order and incident boards live
        in{" "}
        <Link href="/reports" className="text-link hover:underline">
          Issues
        </Link>
        ,{" "}
        <Link href="/work-orders" className="text-link hover:underline">
          Work orders
        </Link>{" "}
        and{" "}
        <Link href="/incidents" className="text-link hover:underline">
          Incidents
        </Link>
        .
      </p>
    </div>
  );
}
