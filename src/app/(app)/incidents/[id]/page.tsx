import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Info, ShieldAlert, UserCheck } from "lucide-react";

import { StatusActions } from "@/components/actions/StatusActions";
import { ResolveIncidentButton } from "@/components/incidents/ResolveIncidentButton";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS, permissionsForRoles } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/format";
import { getIncidentById } from "@/lib/repos/incidents";
import { listUsers } from "@/lib/repos/users";
import { getVehicleById } from "@/lib/repos/vehicles";

export const metadata = { title: "Incident" };

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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

  const [vehicle, users] = await Promise.all([getVehicleById(incident.vehicleId), listUsers()]);
  const userNames = new Map(users.map((u) => [u.id, u.name]));

  const actions =
    canManage && incident.status === "OPEN"
      ? [{ action: "start_review", label: "Start review" }]
      : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={incident.type.replace(/_/g, " ")}
        description={
          <>
            {incident.severity.toLowerCase()} severity · occurred {formatDate(incident.occurredAt)}
            {incident.location ? ` · ${incident.location}` : ""}
          </>
        }
        crumbs={[
          { label: "Finance & compliance" },
          { label: "Incidents", href: "/incidents" },
          { label: incident.type.replace(/_/g, " ").toLowerCase() },
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
            <p className="text-body-sm whitespace-pre-wrap text-ink">{incident.description}</p>
          </Card>

          {incident.resolution && (
            <Card title="Resolution" icon={CheckCircle2}>
              <p className="text-body-sm whitespace-pre-wrap text-ink">{incident.resolution}</p>
              {incident.resolvedByUserId && (
                <p className="text-data-xs mt-3 text-muted">
                  Resolved by {userNames.get(incident.resolvedByUserId) ?? incident.resolvedByUserId} ·{" "}
                  {formatDate(incident.resolvedAt)}
                </p>
              )}
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
                <Link href={`/vehicles/${vehicle.id}`} className="font-medium text-link hover:underline">
                  {vehicle.regNumber}
                </Link>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Type">{incident.type.replace(/_/g, " ")}</DetailRow>
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

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-2.5">
      <span className="font-ui text-data-xs font-medium uppercase tracking-[var(--tracking-ui)] text-muted">
        {label}
      </span>
      <span className="text-data text-right text-ink">{children}</span>
    </div>
  );
}