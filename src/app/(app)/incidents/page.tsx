import { ShieldAlert, ShieldPlus } from "lucide-react";

import { CreateForm } from "@/components/actions/CreateForm";
import { StatusActions } from "@/components/actions/StatusActions";
import { ResolveIncidentButton } from "@/components/incidents/ResolveIncidentButton";
import { Container } from "@/components/layout/Container";
import { Card } from "@/components/ui/Card";
import { DisplayTitle } from "@/components/ui/DisplayTitle";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS, permissionsForRoles } from "@/lib/auth/permissions";
import { INCIDENT_SEVERITIES, INCIDENT_TYPES } from "@/lib/domain/incident";
import { formatDate } from "@/lib/format";
import { countIncidents, listIncidents } from "@/lib/repos/incidents";
import { listVehicles } from "@/lib/repos/vehicles";
import Link from "next/link";

export const metadata = { title: "Incidents" };

function incidentActions(status: string, permissions: string[]) {
  const labels: Record<string, string> = { start_review: "Start review" };
  const map: Record<string, { permission: string; from: string[] }> = {
    start_review: { permission: PERMISSIONS.INCIDENT_MANAGE, from: ["OPEN"] },
  };
  return Object.entries(map)
    .filter(([, def]) => def.from.includes(status) && permissions.includes(def.permission))
    .map(([action]) => ({ action, label: labels[action] ?? action }));
}

export default async function IncidentsPage() {
  const context = await requirePagePermission([
    PERMISSIONS.INCIDENT_READ_OWN,
    PERMISSIONS.INCIDENT_READ_ALL,
  ]);
  const permissions = [...permissionsForRoles(context.user.roles)];
  const canCreate = permissions.includes(PERMISSIONS.INCIDENT_CREATE);
  const canReadAll = permissions.includes(PERMISSIONS.INCIDENT_READ_ALL);
  const canManage = permissions.includes(PERMISSIONS.INCIDENT_MANAGE);

  const scope = canReadAll ? {} : { reportedBy: context.user.id };
  const [incidents, vehicles, incidentTotal] = await Promise.all([
    listIncidents({ ...scope, limit: 100 }),
    listVehicles(),
    countIncidents(scope),
  ]);

  const vehicleName = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    return v ? v.regNumber : "—";
  };

  return (
    <Container className="flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-2">
        <Eyebrow>Restricted</Eyebrow>
        <DisplayTitle size="md">Incidents</DisplayTitle>
        <p className="text-body-sm text-muted">
          Breakdown / accident / passenger / security events. Restricted to
          {canReadAll ? " those with incident:read:all" : " your own reports"}.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card
            title={`${incidentTotal} incident(s)${
              incidents.length < incidentTotal ? ` · showing ${incidents.length}` : ""
            }`}
            icon={ShieldAlert}
          >
            {incidents.length === 0 ? (
              <p className="text-body-xs text-muted px-5 py-8">No incidents reported.</p>
            ) : (
              <ul className="divide-hairline divide-y">
                {incidents.map((incident) => {
                  const actions = incidentActions(incident.status, permissions);
                  return (
                    <li key={incident.id} className="flex flex-col gap-3 px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col">
                          <Link href={`/incidents/${incident.id}`} className="hover:text-ink">
                            <span className="text-body-sm font-medium text-ink">
                              {incident.type.replace(/_/g, " ")}
                            </span>
                          </Link>
                          <span className="text-body-xs text-muted">
                            {vehicleName(incident.vehicleId)} · {incident.severity} ·{" "}
                            {formatDate(incident.occurredAt)}
                            {incident.location ? ` · ${incident.location}` : ""}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <StatusBadge status={incident.status} />
                        </div>
                      </div>
                      <p className="text-body-xs text-muted line-clamp-2">{incident.description}</p>
                      {incident.resolution && (
                        <p className="text-body-xs">
                          <span className="font-ui text-muted mr-1 uppercase">Resolution:</span>
                          {incident.resolution}
                        </p>
                      )}
                      {(actions.length > 0 || canManage) && incident.status !== "RESOLVED" && (
                        <div className="flex flex-wrap items-center gap-2">
                          {actions.length > 0 && (
                            <StatusActions
                              endpoint={`/api/v1/incidents/${incident.id}/status`}
                              actions={actions}
                            />
                          )}
                          {canManage && <ResolveIncidentButton incidentId={incident.id} />}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        {canCreate && (
          <Card title="Report an incident" icon={ShieldPlus}>
            <div className="p-5">
              <CreateForm
                endpoint="/api/v1/incidents"
                submitLabel="Submit incident"
                fields={[
                  {
                    name: "vehicleId",
                    label: "Vehicle",
                    type: "select",
                    required: true,
                    options: vehicles.map((v) => ({
                      value: v.id,
                      label: `${v.regNumber} — ${v.make} ${v.model}`,
                    })),
                  },
                  {
                    name: "type",
                    label: "Type",
                    type: "select",
                    required: true,
                    defaultValue: "BREAKDOWN",
                    options: INCIDENT_TYPES.map((t) => ({ value: t, label: t })),
                  },
                  {
                    name: "severity",
                    label: "Severity",
                    type: "select",
                    required: true,
                    defaultValue: "MEDIUM",
                    options: INCIDENT_SEVERITIES.map((s) => ({ value: s, label: s })),
                  },
                  { name: "location", label: "Location", placeholder: "Accra Mall, Spintex" },
                  {
                    name: "description",
                    label: "What happened",
                    type: "textarea",
                    required: true,
                  },
                ]}
              />
            </div>
          </Card>
        )}
      </div>
    </Container>
  );
}