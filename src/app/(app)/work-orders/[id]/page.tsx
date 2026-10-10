import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  FileText,
  FileWarning,
  History,
  Info,
  ReceiptText,
  Wrench,
} from "lucide-react";

import { StatusActions } from "@/components/actions/StatusActions";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  CompleteWorkOrderDialog,
  type CompletionScheduleOption,
  type CompletionIssueOption,
} from "@/components/work-orders/CompleteWorkOrderDialog";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS, permissionsForRoles } from "@/lib/auth/permissions";
import { COMPLETABLE_STATUSES, WORK_ORDER_ACTIONS } from "@/lib/domain/work-order";
import { formatDate, formatMoney } from "@/lib/format";
import { listExpenses } from "@/lib/repos/expenses";
import { getScheduleById, getServiceRecordById } from "@/lib/repos/maintenance";
import { getIssueById } from "@/lib/repos/reports";
import { listUsers } from "@/lib/repos/users";
import { getVehicleById } from "@/lib/repos/vehicles";
import { getWorkOrderById } from "@/lib/repos/work-orders";

export const metadata = { title: "Work order" };

const LABELS: Record<string, string> = {
  start: "Start work",
  wait: "Wait (parts/provider)",
  resume: "Resume",
  verify: "Verify work",
  close: "Close",
  reopen: "Reopen",
};

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requirePagePermission(PERMISSIONS.WORK_ORDER_READ);
  const { id } = await params;
  const workOrder = await getWorkOrderById(id);
  if (!workOrder) notFound();

  const permissions = [...permissionsForRoles(context.user.roles)];
  const canComplete = permissions.includes(PERMISSIONS.WORK_ORDER_COMPLETE);

  const [vehicle, users, issues, schedules, serviceRecord, expenses] = await Promise.all([
    getVehicleById(workOrder.vehicleId),
    listUsers(),
    Promise.all(workOrder.issueIds.slice(0, 10).map((iid) => getIssueById(iid))),
    Promise.all(workOrder.scheduleIds.slice(0, 10).map((sid) => getScheduleById(sid))),
    workOrder.serviceRecordId ? getServiceRecordById(workOrder.serviceRecordId) : Promise.resolve(null),
    listExpenses({ workOrderId: workOrder.id, limit: 20 }),
  ]);

  const userNames = new Map(users.map((u) => [u.id, u.name]));
  const resolvedIssues = issues.filter((i): i is NonNullable<typeof i> => i !== null);
  const resolvedSchedules = schedules.filter((s): s is NonNullable<typeof s> => s !== null);

  const actions = Object.entries(WORK_ORDER_ACTIONS)
    .filter(
      ([, def]) =>
        (def.from as readonly string[]).includes(workOrder.status) &&
        permissions.includes(def.permission),
    )
    .map(([action]) => ({ action, label: LABELS[action] ?? action }));

  const completable = (COMPLETABLE_STATUSES as readonly string[]).includes(workOrder.status);

  const scheduleOptions: CompletionScheduleOption[] = resolvedSchedules.map((s) => ({
    id: s.id,
    taskName: s.taskName,
  }));
  const issueOptions: CompletionIssueOption[] = resolvedIssues.map((i) => ({
    id: i.id,
    label: `${i.number ?? "Issue"} — ${i.title}`,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={workOrder.title}
        description={
          <>
            {workOrder.number} · {workOrder.priority.toLowerCase()} priority · opened{" "}
            {formatDate(workOrder.openedAt)}
          </>
        }
        crumbs={[
          { label: "Fleet" },
          { label: "Work orders", href: "/work-orders" },
          { label: workOrder.number },
        ]}
        actions={
          <>
            <StatusBadge status={workOrder.status} />
            <StatusBadge status={workOrder.priority} />
          </>
        }
      />

      {/* Lifecycle strip */}
      <Card flush>
        <div className="grid grid-cols-2 divide-x divide-hairline md:grid-cols-4">
          <StripCell label="Vehicle">
            {vehicle ? (
              <Link href={`/vehicles/${vehicle.id}`} className="font-medium text-link hover:underline">
                {vehicle.regNumber}
              </Link>
            ) : (
              "—"
            )}
          </StripCell>
          <StripCell label="Assigned to">
            {workOrder.assignedToUserId
              ? userNames.get(workOrder.assignedToUserId) ?? workOrder.assignedToUserId
              : "Unassigned"}
          </StripCell>
          <StripCell label="Provider">
            {workOrder.providerName ?? workOrder.providerId ?? "—"}
          </StripCell>
          <StripCell label="Status">
            <StatusBadge status={workOrder.status} />
          </StripCell>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          {workOrder.description && (
            <Card title="Description" icon={FileText}>
              <p className="text-body-sm whitespace-pre-wrap text-ink">{workOrder.description}</p>
            </Card>
          )}

          <Card title="Progress" icon={History} flush>
            <Timeline workOrder={workOrder} userNames={userNames} />
          </Card>

          {resolvedIssues.length > 0 && (
            <Card title={`Linked issues (${resolvedIssues.length})`} icon={AlertTriangle} flush>
              <ul className="divide-hairline divide-y">
                {resolvedIssues.map((issue) => (
                  <li key={issue.id}>
                    <Link
                      href={`/reports/${issue.id}`}
                      className="hover:bg-subtle flex items-center justify-between gap-3 px-5 py-3 transition-colors"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <FileWarning aria-hidden="true" className="h-4 w-4 shrink-0 text-faint" />
                        <span className="flex min-w-0 flex-col">
                          <span className="text-data truncate font-medium text-ink">{issue.title}</span>
                          <span className="text-data-xs text-muted">
                            {issue.number ?? "Issue"} · {issue.severity.toLowerCase()}
                          </span>
                        </span>
                      </span>
                      <StatusBadge status={issue.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {resolvedSchedules.length > 0 && (
            <Card title={`Maintenance schedules (${resolvedSchedules.length})`} icon={CalendarClock} flush>
              <ul className="divide-hairline divide-y">
                {resolvedSchedules.map((schedule) => (
                  <li key={schedule.id} className="flex items-center gap-3 px-5 py-2.5">
                    <CircleDot aria-hidden="true" className="h-4 w-4 shrink-0 text-faint" />
                    <span className="text-data flex-1 text-ink">{schedule.taskName}</span>
                    <span className="text-data-xs text-muted">
                      {scheduleIntervalLabel(schedule.intervalKm, schedule.intervalDays)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-body-xs border-hairline border-t px-5 py-3 text-muted">
                Completing this order resets the baselines of exactly these schedules.
              </p>
            </Card>
          )}

          {expenses.length > 0 && (
            <Card title={`Assigned expenses (${expenses.length})`} icon={ReceiptText} flush>
              <ul className="divide-hairline divide-y">
                {expenses.map((expense) => (
                  <li key={expense.id}>
                    <Link
                      href={`/expenses?workOrderId=${workOrder.id}`}
                      className="hover:bg-subtle flex items-center justify-between gap-3 px-5 py-2.5 transition-colors"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <ReceiptText aria-hidden="true" className="h-4 w-4 shrink-0 text-faint" />
                        <span className="flex min-w-0 flex-col">
                          <span className="text-data truncate font-medium text-ink">
                            {expense.category.replace(/_/g, " ").toLowerCase()}
                          </span>
                          <span className="text-data-xs text-muted">{formatDate(expense.incurredOn)}</span>
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-data tabular-nums text-ink">
                          {formatMoney(expense.amountMinor, expense.currency)}
                        </span>
                        <StatusBadge status={expense.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {serviceRecord && (
            <Card title="Service record" icon={CheckCircle2} flush>
              <div className="divide-hairline divide-y px-5">
                <DetailRow label="Task">{serviceRecord.taskName}</DetailRow>
                <DetailRow label="Completed at">{formatDate(serviceRecord.completedAt)}</DetailRow>
                <DetailRow label="Odometer">
                  {serviceRecord.odometerKm.toLocaleString()} km
                </DetailRow>
                <DetailRow label="Work performed">{serviceRecord.workPerformed}</DetailRow>
                {serviceRecord.outcome && <DetailRow label="Outcome">{serviceRecord.outcome}</DetailRow>}
                {serviceRecord.providerName && (
                  <DetailRow label="Provider">{serviceRecord.providerName}</DetailRow>
                )}
                {serviceRecord.technicianName && (
                  <DetailRow label="Technician">{serviceRecord.technicianName}</DetailRow>
                )}
                {serviceRecord.notes && <DetailRow label="Notes">{serviceRecord.notes}</DetailRow>}
              </div>
              <p className="text-body-xs text-muted border-hairline border-t px-5 py-3">
                Service records are immutable — completion writes the record, resets schedule
                baselines and logs the odometer in one audited flow.
              </p>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Card title="Actions" icon={Wrench} flush>
            <div className="flex flex-col gap-2 px-5 py-4">
              {actions.length === 0 && !completable && (
                <p className="text-body-xs text-muted">No actions available in this state.</p>
              )}
              {actions.length > 0 && (
                <StatusActions
                  endpoint={`/api/v1/work-orders/${workOrder.id}/status`}
                  actions={actions}
                  reason={{
                    wait: {
                      field: "waitingReason",
                      label: "Waiting reason",
                      placeholder: "Awaiting parts from supplier",
                    },
                  }}
                />
              )}
              {canComplete && completable && (
                <CompleteWorkOrderDialog
                  workOrderId={workOrder.id}
                  currentOdometerKm={vehicle?.odometerKm ?? 0}
                  schedules={scheduleOptions}
                  issues={issueOptions}
                />
              )}
            </div>
          </Card>

          <Card title="Record" icon={Info} flush>
            <DetailRow label="Opened by">
              {userNames.get(workOrder.createdBy) ?? workOrder.createdBy}
            </DetailRow>
            <DetailRow label="Created">{formatDate(workOrder.createdAt)}</DetailRow>
            {workOrder.startedAt && <DetailRow label="Started">{formatDate(workOrder.startedAt)}</DetailRow>}
            {workOrder.waitingSince && (
              <DetailRow label="Waiting since">{formatDate(workOrder.waitingSince)}</DetailRow>
            )}
            {workOrder.waitingReason && (
              <DetailRow label="Wait reason">{workOrder.waitingReason}</DetailRow>
            )}
            {workOrder.completedAt && (
              <DetailRow label="Completed">
                {formatDate(workOrder.completedAt)} ·{" "}
                {workOrder.completionOdometerKm?.toLocaleString()} km
              </DetailRow>
            )}
            {workOrder.verifiedAt && (
              <DetailRow label="Verified">
                {formatDate(workOrder.verifiedAt)} by{" "}
                {workOrder.verifiedByUserId
                  ? userNames.get(workOrder.verifiedByUserId) ?? workOrder.verifiedByUserId
                  : "—"}
              </DetailRow>
            )}
            {workOrder.closedAt && <DetailRow label="Closed">{formatDate(workOrder.closedAt)}</DetailRow>}
          </Card>
        </div>
      </div>
    </div>
  );
}

function StripCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-5 py-4">
      <span className="font-ui text-data-xs font-medium uppercase tracking-[var(--tracking-ui)] text-muted">
        {label}
      </span>
      <span className="text-data font-medium text-ink">{children}</span>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <span className="font-ui text-data-xs font-medium uppercase tracking-[var(--tracking-ui)] text-muted">
        {label}
      </span>
      <span className="text-data text-right text-ink">{children}</span>
    </div>
  );
}

function scheduleIntervalLabel(intervalKm?: number, intervalDays?: number): string {
  if (intervalKm && intervalDays) return `every ${intervalKm.toLocaleString()} km or ${intervalDays} days`;
  if (intervalKm) return `every ${intervalKm.toLocaleString()} km`;
  if (intervalDays) return `every ${intervalDays} days`;
  return "interval not set";
}

function Timeline({
  workOrder,
  userNames,
}: {
  workOrder: NonNullable<Awaited<ReturnType<typeof getWorkOrderById>>>;
  userNames: Map<string, string>;
}) {
  const steps: { label: string; at?: Date; detail?: string }[] = [
    { label: "Opened", at: workOrder.openedAt },
    { label: "Started", at: workOrder.startedAt },
    {
      label: "Waiting",
      at: workOrder.waitingSince,
      detail: workOrder.waitingReason ? `waiting: ${workOrder.waitingReason}` : undefined,
    },
    {
      label: "Completed",
      at: workOrder.completedAt,
      detail:
        workOrder.completionOdometerKm !== undefined
          ? `at ${workOrder.completionOdometerKm.toLocaleString()} km`
          : undefined,
    },
    {
      label: "Verified",
      at: workOrder.verifiedAt,
      detail: workOrder.verifiedByUserId
        ? `by ${userNames.get(workOrder.verifiedByUserId) ?? workOrder.verifiedByUserId}`
        : undefined,
    },
    { label: "Closed", at: workOrder.closedAt },
  ];

  return (
    <ol className="flex flex-col">
      {steps.map((step, index) => {
        const done = step.at !== undefined;
        const isLast = index === steps.length - 1;
        return (
          <li key={step.label} className="relative flex gap-3 px-5 pb-4 pt-4">
            {!isLast && (
              <span
                aria-hidden="true"
                className={`absolute left-[1.625rem] top-9 h-full w-px ${
                  done ? "bg-accent" : "bg-[var(--border-hairline)]"
                }`}
              />
            )}
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                done ? "border-accent bg-accent" : "border-hairline bg-surface"
              }`}
            />
            <span className="flex flex-col">
              <span className={`text-data font-medium ${done ? "text-ink" : "text-faint"}`}>
                {step.label}
              </span>
              {done && step.at && (
                <span className="text-data-xs text-muted">
                  {formatDate(step.at)}
                  {step.detail ? ` — ${step.detail}` : ""}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}