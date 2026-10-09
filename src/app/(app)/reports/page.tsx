import { CreateForm } from "@/components/actions/CreateForm";
import { CreateWorkOrderButton } from "@/components/actions/CreateWorkOrderButton";
import { StatusActions } from "@/components/actions/StatusActions";
import { Container } from "@/components/layout/Container";
import { Card } from "@/components/ui/Card";
import { DisplayTitle } from "@/components/ui/DisplayTitle";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requireAuthContext } from "@/lib/auth/guards";
import { PERMISSIONS, permissionsForRoles } from "@/lib/auth/permissions";
import { REPORT_SEVERITIES } from "@/lib/domain/report";
import { formatDate } from "@/lib/format";
import { listReports } from "@/lib/repos/reports";
import { listVehicles } from "@/lib/repos/vehicles";

export const metadata = { title: "Reports" };

function reportActions(status: string, permissions: string[]) {
  const labels: Record<string, string> = { triage: "Mark triaged", close: "Close report" };
  const map: Record<string, { permission: string; from: string[] }> = {
    triage: { permission: "report:triage", from: ["OPEN"] },
    close: { permission: "report:close", from: ["OPEN", "TRIAGED"] },
  };
  return Object.entries(map)
    .filter(([, def]) => def.from.includes(status) && permissions.includes(def.permission))
    .map(([action]) => ({ action, label: labels[action] ?? action }));
}

export default async function ReportsPage() {
  const context = await requireAuthContext();
  const permissions = [...permissionsForRoles(context.user.roles)];
  const canCreate = permissions.includes(PERMISSIONS.REPORT_CREATE);
  const canReadAll = permissions.includes(PERMISSIONS.REPORT_READ_ALL);
  const canCreateWorkOrder = permissions.includes(PERMISSIONS.WORK_ORDER_CREATE);

  const [reports, vehicles] = await Promise.all([
    listReports(canReadAll ? { limit: 100 } : { scopeUserId: context.user.id, limit: 100 }),
    listVehicles(),
  ]);

  const vehicleName = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    return v ? v.regNumber : "—";
  };

  return (
    <Container className="flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-2">
        <Eyebrow>Maintenance</Eyebrow>
        <DisplayTitle size="md">{canReadAll ? "All reports" : "My reports"}</DisplayTitle>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card title={`${reports.length} report(s)`}>
            {reports.length === 0 ? (
              <p className="text-body-xs text-muted px-5 py-8">No reports yet.</p>
            ) : (
              <ul className="divide-hairline divide-y">
                {reports.map((report) => {
                  const actions = reportActions(report.status, permissions);
                  return (
                    <li key={report.id} className="flex flex-col gap-3 px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col">
                          <span className="text-body-sm font-medium">{report.title}</span>
                          <span className="text-body-xs text-muted">
                            {vehicleName(report.vehicleId)} · {report.severity} ·{" "}
                            {formatDate(report.createdAt)}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <StatusBadge status={report.severity} />
                          <StatusBadge status={report.status} />
                        </div>
                      </div>
                      <p className="text-body-xs text-muted line-clamp-2">{report.description}</p>
                      {(actions.length > 0 ||
                        (canCreateWorkOrder &&
                          !report.workOrderId &&
                          report.status !== "CLOSED")) && (
                        <div className="flex flex-wrap items-center gap-2">
                          {actions.length > 0 && (
                            <StatusActions
                              endpoint={`/api/v1/reports/${report.id}/status`}
                              actions={actions.map(({ action, label }) => ({ action, label }))}
                            />
                          )}
                          {canCreateWorkOrder &&
                            !report.workOrderId &&
                            report.status !== "CLOSED" && (
                              <CreateWorkOrderButton reportId={report.id} />
                            )}
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
          <Card title="Report an issue">
            <div className="p-5">
              <CreateForm
                endpoint="/api/v1/reports"
                submitLabel="Submit report"
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
                  { name: "title", label: "Title", required: true, placeholder: "Brake noise" },
                  { name: "description", label: "Description", type: "textarea", required: true },
                  {
                    name: "severity",
                    label: "Severity",
                    type: "select",
                    required: true,
                    defaultValue: "MEDIUM",
                    options: REPORT_SEVERITIES.map((s) => ({ value: s, label: s })),
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
