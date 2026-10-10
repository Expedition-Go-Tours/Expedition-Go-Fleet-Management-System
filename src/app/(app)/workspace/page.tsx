import { CreateForm } from "@/components/actions/CreateForm";
import { Container } from "@/components/layout/Container";
import { Card } from "@/components/ui/Card";
import { DisplayTitle } from "@/components/ui/DisplayTitle";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EndAssignmentButton } from "@/components/workspace/EndAssignmentButton";
import {
  NotificationList,
  type WorkspaceNotification,
} from "@/components/workspace/NotificationList";
import { requireAuthContext } from "@/lib/auth/guards";
import { PERMISSIONS, permissionsForRoles } from "@/lib/auth/permissions";
import { ISSUE_CATEGORIES, REPORT_SEVERITIES } from "@/lib/domain/report";
import { formatDate, formatKm } from "@/lib/format";
import { getActiveAssignmentForDriver } from "@/lib/repos/assignments";
import { listNotifications } from "@/lib/repos/notifications";
import { listIssues } from "@/lib/repos/reports";
import { listVehicles } from "@/lib/repos/vehicles";

export const metadata = { title: "Driver workspace" };

/**
 * Driver-facing workspace: current trip (start/end with odometer),
 * personal issues + quick report form, and in-app notifications.
 * All mutations go through the /api/v1 endpoints; nothing here bypasses
 * the ledger or permission checks.
 */
export default async function WorkspacePage() {
  const context = await requireAuthContext();
  const permissions = [...permissionsForRoles(context.user.roles)];
  const canCreateReport = permissions.includes(PERMISSIONS.REPORT_CREATE);

  const [assignment, issues, vehicles, notificationsByRole] = await Promise.all([
    getActiveAssignmentForDriver(context.user.id),
    listIssues({ reportedBy: context.user.id, limit: 10 }),
    listVehicles(),
    Promise.all(context.user.roles.map((role) => listNotifications({ recipientRole: role, limit: 500 }))),
  ]);

  const merged = new Map<string, (typeof notificationsByRole)[number][number]>();
  for (const list of notificationsByRole) for (const n of list) merged.set(n.id, n);
  const notifications: WorkspaceNotification[] = [...merged.values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 10)
    .map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      type: n.type,
      createdAt: formatDate(n.createdAt),
      read: Boolean(n.readAt),
    }));
  const unreadCount = [...merged.values()].filter((n) => !n.readAt).length;

  const vehicle = assignment ? vehicles.find((v) => v.id === assignment.vehicleId) ?? null : null;

  return (
    <Container className="flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-2">
        <Eyebrow>Driver workspace</Eyebrow>
        <DisplayTitle size="md">My day</DisplayTitle>
      </div>

      <Card title={assignment ? "Active trip" : "No active trip"}>
        <div className="p-5">
          {assignment && vehicle ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-body-sm font-medium">
                  {vehicle.regNumber} — {vehicle.make} {vehicle.model}
                </span>
                <StatusBadge status={assignment.status} />
                <span className="font-ui text-muted ml-auto text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
                  {assignment.purpose.replace(/_/g, " ")}
                </span>
              </div>
              <p className="text-body-xs text-muted">
                Started {formatDate(assignment.startedAt)} at{" "}
                {formatKm(assignment.startOdometerKm ?? 0)}.
              </p>
              <EndAssignmentButton
                assignmentId={assignment.id}
                minKm={assignment.startOdometerKm ?? 0}
                vehicleLabel={vehicle.regNumber}
              />
            </div>
          ) : (
            <p className="text-body-xs text-muted py-2">
              {assignment
                ? "Assigned vehicle not found."
                : "You have no assigned trip. Contact operations to be assigned a vehicle."}
            </p>
          )}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card title={`My reported issues (${issues.length})`}>
            {issues.length === 0 ? (
              <p className="text-body-xs text-muted px-5 py-6">
                You have not reported any issues.
              </p>
            ) : (
              <ul className="divide-hairline divide-y">
                {issues.map((issue) => {
                  const v = vehicles.find((x) => x.id === issue.vehicleId);
                  return (
                    <li key={issue.id} className="flex items-start justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="text-body-sm font-medium">
                          {issue.number ? `${issue.number} — ` : ""}
                          {issue.title}
                        </p>
                        <p className="text-body-xs text-muted mt-0.5">
                          {v ? v.regNumber : "—"} · {issue.severity} · {formatDate(issue.createdAt)}
                        </p>
                      </div>
                      <StatusBadge status={issue.status} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <div className="mt-6">
            <Card title="Notifications">
              <NotificationList notifications={notifications} />
            </Card>
          </div>
        </div>

        {canCreateReport && (
          <Card title="Report a problem">
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
                  {
                    name: "category",
                    label: "Category",
                    type: "select",
                    options: ISSUE_CATEGORIES.map((c) => ({ value: c, label: c })),
                  },
                  {
                    name: "description",
                    label: "Description",
                    type: "textarea",
                    required: true,
                  },
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

      {unreadCount > 0 && (
        <p className="font-ui text-muted text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
          {unreadCount} unread notification{unreadCount === 1 ? "" : "s"}
        </p>
      )}
    </Container>
  );
}