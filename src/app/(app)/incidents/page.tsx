import { ChevronLeft, ChevronRight, ShieldAlert, ShieldPlus } from "lucide-react";

import { CreateForm } from "@/components/actions/CreateForm";
import { StatusActions } from "@/components/actions/StatusActions";
import { IncidentFilters } from "@/components/incidents/IncidentFilters";
import { ResolveIncidentButton } from "@/components/incidents/ResolveIncidentButton";
import { Container } from "@/components/layout/Container";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS, permissionsForRoles } from "@/lib/auth/permissions";
import { INCIDENT_SEVERITIES, INCIDENT_TYPES } from "@/lib/domain/incident";
import { formatDate, humanizeEnum } from "@/lib/format";
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

const PAGE_SIZE = 20;

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ severity?: string; status?: string; page?: string }>;
}) {
  const context = await requirePagePermission([
    PERMISSIONS.INCIDENT_READ_OWN,
    PERMISSIONS.INCIDENT_READ_ALL,
  ]);
  const permissions = [...permissionsForRoles(context.user.roles)];
  const canCreate = permissions.includes(PERMISSIONS.INCIDENT_CREATE);
  const canReadAll = permissions.includes(PERMISSIONS.INCIDENT_READ_ALL);
  const canManage = permissions.includes(PERMISSIONS.INCIDENT_MANAGE);

  const params = await searchParams;
  const severity = params.severity?.trim() || undefined;
  const status = params.status?.trim() || undefined;
  const pageRaw = Number(params.page);
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const scope = canReadAll ? {} : { reportedBy: context.user.id };
  const [incidentsAll, vehicles, incidentTotal] = await Promise.all([
    listIncidents({ ...scope, severity, status, limit: 500 }),
    listVehicles(),
    countIncidents(scope),
  ]);

  const incidents = incidentsAll;

  const totalPages = Math.max(1, Math.ceil(incidents.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const rows = incidents.slice(pageStart, pageStart + PAGE_SIZE);

  function pageHref(nextPage: number): string {
    const url = new URLSearchParams();
    if (severity) url.set("severity", severity);
    if (status) url.set("status", status);
    if (nextPage > 1) url.set("page", String(nextPage));
    const query = url.toString();
    return query ? `/incidents?${query}` : "/incidents";
  }

  const vehicleName = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    return v ? v.regNumber : "—";
  };

  return (
    <Container className="flex flex-col gap-8 py-10">
      <PageHeader
        title={canReadAll ? "Incidents" : "My incidents"}
        description={`Breakdown / accident / passenger / security events. Restricted to${canReadAll ? " those with incident:read:all" : " your own reports"}.`}
        crumbs={[{ label: "Finance & compliance" }, { label: "Incidents" }]}
      />

      <IncidentFilters />

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
                {rows.map((incident) => {
                  const actions = incidentActions(incident.status, permissions);
                  return (
                    <li key={incident.id} className="flex flex-col gap-3 px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col">
                          <Link href={`/incidents/${incident.id}`} className="hover:text-ink">
                            <span className="text-body-sm text-ink font-medium">
                              {humanizeEnum(incident.type)}
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
            {incidents.length > PAGE_SIZE && (
              <div className="border-hairline bg-subtle flex items-center justify-between gap-3 border-t px-4 py-2.5">
                <p className="text-data-xs text-muted">
                  Showing {pageStart + 1}–{pageStart + rows.length} of {incidents.length}
                </p>
                <div className="flex items-center gap-1">
                  <PagerLink
                    href={pageHref(safePage - 1)}
                    disabled={safePage <= 1}
                    label="Previous page"
                    icon={<ChevronLeft aria-hidden="true" className="h-4 w-4" />}
                  />
                  <span className="text-data-xs text-muted px-2">
                    Page {safePage} of {totalPages}
                  </span>
                  <PagerLink
                    href={pageHref(safePage + 1)}
                    disabled={safePage >= totalPages}
                    label="Next page"
                    icon={<ChevronRight aria-hidden="true" className="h-4 w-4" />}
                  />
                </div>
              </div>
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

function PagerLink({
  href,
  disabled,
  label,
  icon,
}: {
  href: string;
  disabled: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span
        className="text-faint flex h-8 w-8 items-center justify-center rounded-md"
        aria-disabled="true"
      >
        {icon}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className="hover:bg-subtle hover:text-ink text-muted border-hairline bg-surface flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
    >
      {icon}
    </Link>
  );
}
