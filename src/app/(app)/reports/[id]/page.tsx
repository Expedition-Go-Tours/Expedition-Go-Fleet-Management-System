import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  FileWarning,
  History,
  Info,
  MessageSquare,
  Paperclip,
  ShieldAlert,
  Wrench,
} from "lucide-react";

import { CreateWorkOrderButton } from "@/components/actions/CreateWorkOrderButton";
import { StatusActions } from "@/components/actions/StatusActions";
import { CloseIssueDialog } from "@/components/reports/CloseIssueDialog";
import { Card } from "@/components/ui/Card";
import { DetailRow } from "@/components/ui/DetailRow";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS, permissionsForRoles } from "@/lib/auth/permissions";
import { formatDate, humanizeEnum } from "@/lib/format";
import { getIssueById } from "@/lib/repos/reports";
import { listUsers } from "@/lib/repos/users";
import { getVehicleById } from "@/lib/repos/vehicles";
import { getWorkOrderById } from "@/lib/repos/work-orders";

export const metadata = { title: "Issue" };

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePagePermission([
    PERMISSIONS.REPORT_READ_OWN,
    PERMISSIONS.REPORT_READ_ALL,
  ]);
  const { id } = await params;
  const issue = await getIssueById(id);
  if (!issue) notFound();

  const permissions = [...permissionsForRoles(context.user.roles)];
  const canReadAll = permissions.includes(PERMISSIONS.REPORT_READ_ALL);
  const canTriage = permissions.includes(PERMISSIONS.REPORT_TRIAGE);
  const canClose = permissions.includes(PERMISSIONS.REPORT_CLOSE);
  const canCreateWorkOrder = permissions.includes(PERMISSIONS.WORK_ORDER_CREATE);

  // Read realm: own reports, or everything with report:read:all.
  if (!canReadAll && issue.reportedBy !== context.user.id) notFound();

  const [vehicle, users, linkedWorkOrders] = await Promise.all([
    getVehicleById(issue.vehicleId),
    listUsers(),
    Promise.all(issue.linkedWorkOrderIds.slice(0, 10).map((woId) => getWorkOrderById(woId))),
  ]);

  const userNames = new Map(users.map((u) => [u.id, u.name]));
  const reporterName = userNames.get(issue.reportedBy) ?? issue.reportedBy;
  const triagedBy = issue.triagedBy ? (userNames.get(issue.triagedBy) ?? issue.triagedBy) : null;
  const closedBy = issue.closedBy ? (userNames.get(issue.closedBy) ?? issue.closedBy) : null;
  const activeWorkOrders = linkedWorkOrders.filter(
    (wo): wo is NonNullable<typeof wo> => wo !== null,
  );
  const canCloseIssue =
    canClose &&
    (issue.status === "OPEN" || issue.status === "TRIAGED") &&
    !issue.resolvedByWorkOrderId;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={issue.title}
        description={
          <>
            {issue.number ? `${issue.number} · ` : "Issue "}
            {issue.category ? humanizeEnum(issue.category) : "—"} · reported{" "}
            {formatDate(issue.createdAt)}
          </>
        }
        crumbs={[
          { label: "Fleet" },
          { label: "Issues", href: "/reports" },
          { label: issue.number ?? issue.title },
        ]}
        actions={
          <>
            {issue.safetyCritical && <StatusBadge status="SAFETY" tone="danger" />}
            <StatusBadge status={issue.severity} />
            <StatusBadge status={issue.status} />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <Card title="Description" icon={FileText} flush={false}>
            <p className="text-body-sm text-ink whitespace-pre-wrap">{issue.description}</p>
            {issue.affectsSafeOperation || issue.immobilized ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {issue.affectsSafeOperation && (
                  <span className="border-warning/30 bg-warning/10 text-warning inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium">
                    <FileWarning aria-hidden="true" className="h-3.5 w-3.5" />
                    Affects safe operation
                  </span>
                )}
                {issue.immobilized && (
                  <span className="border-error/30 bg-error/10 text-error inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium">
                    <ShieldAlert aria-hidden="true" className="h-3.5 w-3.5" />
                    Vehicle immobilized
                  </span>
                )}
              </div>
            ) : null}
          </Card>

          {activeWorkOrders.length > 0 && (
            <Card title="Linked work orders" icon={Wrench} flush>
              <ul className="divide-hairline divide-y">
                {activeWorkOrders.map((wo) => (
                  <li key={wo.id}>
                    <Link
                      href={`/work-orders/${wo.id}`}
                      className="hover:bg-subtle flex items-center justify-between gap-3 px-5 py-3.5 transition-colors"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <Wrench aria-hidden="true" className="text-faint h-4 w-4 shrink-0" />
                        <span className="flex min-w-0 flex-col">
                          <span className="text-data text-ink truncate font-medium">
                            {wo.title}
                          </span>
                          <span className="text-data-xs text-muted">
                            {wo.number} · {humanizeEnum(wo.priority)}
                          </span>
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <StatusBadge status={wo.status} />
                        <ArrowRight aria-hidden="true" className="text-faint h-4 w-4" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {issue.followUps.length > 0 && (
            <Card title={`Follow-ups (${issue.followUps.length})`} icon={MessageSquare} flush>
              <ul className="divide-hairline divide-y">
                {issue.followUps.map((f, index) => (
                  <li key={index} className="flex flex-col gap-1 px-5 py-3.5">
                    <p className="text-data text-ink">{f.text}</p>
                    <p className="text-data-xs text-muted">
                      {userNames.get(f.byUserId) ?? f.byUserId} · {formatDate(f.at)}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {issue.evidenceKeys.length > 0 && (
            <Card title={`Evidence (${issue.evidenceKeys.length})`} icon={Paperclip}>
              <ul className="flex flex-col gap-1.5">
                {issue.evidenceKeys.map((key) => (
                  <li key={key} className="text-data-xs text-muted font-mono">
                    {key}
                  </li>
                ))}
              </ul>
              <p className="text-body-xs text-muted mt-3">
                Evidence files are stored securely in private object storage. The keys above are
                audit references for traceability. Contact your fleet administrator to access
                original files if needed.
              </p>
            </Card>
          )}
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
                "Unassigned"
              )}
            </DetailRow>
            <DetailRow label="Reported by">{reporterName}</DetailRow>
            <DetailRow label="Severity">
              <StatusBadge status={issue.severity} />
            </DetailRow>
            <DetailRow label="Category">
              {issue.category ? humanizeEnum(issue.category) : "—"}
            </DetailRow>
            <DetailRow label="Odometer at report">
              {typeof issue.odometerKm === "number"
                ? `${issue.odometerKm.toLocaleString()} km`
                : "—"}
            </DetailRow>
            <DetailRow label="Location">{issue.location ?? "—"}</DetailRow>
            <DetailRow label="Reported at">{formatDate(issue.createdAt)}</DetailRow>
            {triagedBy && <DetailRow label="Triaged by">{triagedBy}</DetailRow>}
            {closedBy && <DetailRow label="Closed by">{closedBy}</DetailRow>}
            {issue.resolvedAt && (
              <DetailRow label="Resolved at">{formatDate(issue.resolvedAt)}</DetailRow>
            )}
          </Card>

          {(canTriage || canCloseIssue) && issue.status !== "CLOSED" && (
            <Card title="Lifecycle" icon={History} flush>
              <div className="flex flex-col gap-2 px-5 py-4">
                {canTriage && issue.status === "OPEN" && (
                  <StatusActions
                    endpoint={`/api/v1/reports/${issue.id}/status`}
                    actions={[{ action: "triage", label: "Mark triaged" }]}
                  />
                )}
                {canCloseIssue && <CloseIssueDialog issueId={issue.id} />}
                {canCreateWorkOrder && activeWorkOrders.length === 0 && (
                  <CreateWorkOrderButton reportId={issue.id} />
                )}
              </div>
            </Card>
          )}

          {issue.resolution && (
            <Card title="Resolution" icon={CheckCircle2}>
              <p className="text-body-sm text-ink whitespace-pre-wrap">{issue.resolution}</p>
              {issue.duplicateOfIssueId && (
                <p className="text-data-xs text-muted mt-2">
                  Duplicates: <span className="font-mono">{issue.duplicateOfIssueId}</span>
                </p>
              )}
              {issue.notActionableReason && (
                <p className="text-body-xs text-muted mt-2">
                  Not actionable: {issue.notActionableReason}
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
