import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CheckCircle2, Info, ShieldAlert, UserCheck, Wrench } from "lucide-react";

import { StatusActions } from "@/components/actions/StatusActions";
import { ResolveIncidentButton } from "@/components/incidents/ResolveIncidentButton";
import { Card } from "@/components/ui/Card";
import { DetailRow } from "@/components/ui/DetailRow";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS, permissionsForRoles } from "@/lib/auth/permissions";
import { formatDate, humanizeEnum } from "@/lib/format";
import { getIncidentById } from "@/lib/repos/incidents";
import { listUsers } from "@/lib/repos/users";
import { getVehicleById } from "@/lib/repos/vehicles";
import { listWorkOrders } from "@/lib/repos/work-orders";
import { listIssues } from "@/lib/repos/reports";

export const metadata = { title: "Incident" };

export default async function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePagePermission([
    PERMISSIONS.INCIDENT_READ_OWN,
    PERMISSIONS.INCIDENT_READ_ALL,
  ]);
  const { id } = await params;
  const incident = await getIncidentById(id);
  if (!incident) notFound();

  const permissions = [...permissionsForRoles(context.user.roles)];
  const canReadAll = permissions.includes(PERMISSIONS.INCIDENT_READ_ALL);
  const canManage = permissions.includes(PERMISSIONS.INCIDENT_MANAGE);

  // Read realm: the reporter always sees their own report; everyone else
  // needs incident:read:all.
  if (!canReadAll && incident.reportedByUserId !== context.user.id) notFound();

  const [vehicle, users, vehicleWorkOrders, vehicleIssues] = await Promise.all([
    getVehicleById(incident.vehicleId),
    listUsers(),
    listWorkOrders({ vehicleId: incident.vehicleId, limit: 10 }),
    listIssues({ vehicleId: incident.vehicleId, limit: 10 }),
  ]);
  const userNames = new Map(users.map((u) => [u.id, u.name]));

  const actions =
    canManage && incident.status === "OPEN"
      ? [{ action: "start_review", label: "Start review" }]
      : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={humanizeEnum(incident.type)}
        description={
          <>
            {humanizeEnum(incident.severity)} severity · occurred {formatDate(incident.occurredAt)}
            {incident.location ? ` · ${incident.location}` : ""}
          </>
        }
        crumbs={[
          { label: "Finance & compliance" },
          { label: "Incidents", href: "/incidents" },
          { label: humanizeEnum(incident.type) },
        ]}
        actions={
          <>
            <StatusBadge status={incident.severity} />
            <StatusBadge status={incident.status} />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <Card title="What happened" icon={ShieldAlert}>
            <p className="text-body-sm text-ink whitespace-pre-wrap">{incident.description}</p>
          </Card>

          {incident.resolution && (
            <Card title="Resolution" icon={CheckCircle2}>
              <p className="text-body-sm text-ink whitespace-pre-wrap">{incident.resolution}</p>
              {incident.resolvedByUserId && (
                <p className="text-data-xs text-muted mt-3">
                  Resolved by{" "}
                  {userNames.get(incident.resolvedByUserId) ?? incident.resolvedByUserId} ·{" "}
                  {formatDate(incident.resolvedAt)}
                </p>
              )}
            </Card>
          )}

          {(vehicleWorkOrders.length > 0 || vehicleIssues.length > 0) && (
            <Card title="Related records" icon={Wrench} flush>
              <ul className="divide-hairline divide-y">
                {vehicleWorkOrders.map((wo) => (
                  <li key={wo.id}>
                    <Link
                      href={`/work-orders/${wo.id}`}
                      className="hover:bg-subtle flex items-center justify-between gap-3 px-5 py-3 transition-colors"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <Wrench aria-hidden="true" className="text-faint h-4 w-4 shrink-0" />
                        <span className="flex min-w-0 flex-col">
                          <span className="text-data text-ink truncate font-medium">
                            {wo.title}
                          </span>
                          <span className="text-data-xs text-muted">
                            Work order · {wo.status} · {formatDate(wo.createdAt)}
                          </span>
                        </span>
                      </span>
                      <ArrowRight aria-hidden="true" className="text-faint h-4 w-4" />
                    </Link>
                  </li>
                ))}
                {vehicleIssues.map((issue) => (
                  <li key={issue.id}>
                    <Link
                      href={`/reports/${issue.id}`}
                      className="hover:bg-subtle flex items-center justify-between gap-3 px-5 py-3 transition-colors"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <ShieldAlert aria-hidden="true" className="text-faint h-4 w-4 shrink-0" />
                        <span className="flex min-w-0 flex-col">
                          <span className="text-data text-ink truncate font-medium">
                            {issue.title}
                          </span>
                          <span className="text-data-xs text-muted">
                            Issue · {issue.severity} · {formatDate(issue.createdAt)}
                          </span>
                        </span>
                      </span>
                      <ArrowRight aria-hidden="true" className="text-faint h-4 w-4" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <p className="text-body-xs text-muted">
            Incident reports are restricted records: reporters see their own; read-all and review
            are permission-gated. Every status change is audited with the actor id.
          </p>
        </div>

        <div className="flex flex-col gap-6">
          <Card title="Details" icon={Info} flush>
            <DetailRow label="Vehicle">
              {vehicle ? (
                <Link
                  href={`/vehicles/${vehicle.id}`}
                  className="text-link font-medium hover:underline"
                >
                  {vehicle.regNumber}
                </Link>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Type">{humanizeEnum(incident.type)}</DetailRow>
            <DetailRow label="Severity">
              <StatusBadge status={incident.severity} />
            </DetailRow>
            <DetailRow label="Reported by">
              {userNames.get(incident.reportedByUserId) ?? incident.reportedByUserId}
            </DetailRow>
            <DetailRow label="Occurred at">{formatDate(incident.occurredAt)}</DetailRow>
            <DetailRow label="Reported at">{formatDate(incident.createdAt)}</DetailRow>
            {incident.location && <DetailRow label="Location">{incident.location}</DetailRow>}
          </Card>

          {(actions.length > 0 || (canManage && incident.status !== "RESOLVED")) && (
            <Card title="Review" icon={UserCheck} flush>
              <div className="flex flex-wrap gap-2 px-5 py-4">
                {actions.length > 0 && (
                  <StatusActions
                    endpoint={`/api/v1/incidents/${incident.id}/status`}
                    actions={actions}
                  />
                )}
                {canManage && incident.status !== "RESOLVED" && (
                  <ResolveIncidentButton incidentId={incident.id} />
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
