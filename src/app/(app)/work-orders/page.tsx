import { ChevronLeft, ChevronRight, FilePlus2, Wrench } from "lucide-react";

import { CreateForm } from "@/components/actions/CreateForm";
import { StatusActions } from "@/components/actions/StatusActions";
import { Container } from "@/components/layout/Container";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { WorkOrderFilters } from "@/components/work-orders/WorkOrderFilters";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { permissionsForRoles, PERMISSIONS } from "@/lib/auth/permissions";
import {
  WORK_ORDER_ACTIONS,
  WORK_ORDER_ACTION_LABELS,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
  type WorkOrderStatus,
} from "@/lib/domain/work-order";
import { formatDate } from "@/lib/format";
import { listVehicles } from "@/lib/repos/vehicles";
import { countWorkOrderTotals, countWorkOrders, listWorkOrders } from "@/lib/repos/work-orders";
import Link from "next/link";

export const metadata = { title: "Work orders" };

const OPEN_STATUSES = new Set(["OPEN", "IN_PROGRESS", "WAITING"]);
const PAGE_SIZE = 20;

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ vehicleId?: string; status?: string; open?: string; page?: string }>;
}) {
  const context = await requirePagePermission(PERMISSIONS.WORK_ORDER_READ);
  const permissions = [...permissionsForRoles(context.user.roles)];
  const canCreate = permissions.includes("work_order:create");

  const params = await searchParams;
  const vehicleId = params.vehicleId?.trim() || undefined;
  const openOnly = params.open === "1";
  const statusParam = (params.status ?? "").toUpperCase();
  const pageRaw = Number(params.page);
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  // `open` takes precedence over `status` so the server matches what the filter
  // control shows (it renders "Open (active)" whenever open=1).
  const status =
    !openOnly && (WORK_ORDER_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as WorkOrderStatus)
      : undefined;

  const [workOrdersAll, vehicles, totals, statusCount] = await Promise.all([
    listWorkOrders({ vehicleId, limit: 500 }),
    listVehicles(),
    countWorkOrderTotals({ vehicleId }),
    status ? countWorkOrders({ vehicleId, status }) : Promise.resolve(null),
  ]);

  const workOrders = status
    ? workOrdersAll.filter((w) => w.status === status)
    : openOnly
      ? workOrdersAll.filter((w) => OPEN_STATUSES.has(w.status))
      : workOrdersAll;
  const shownTotal = status
    ? (statusCount ?? workOrders.length)
    : openOnly
      ? totals.open
      : totals.total;

  const vehicleName = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    return v ? v.regNumber : "—";
  };
  const filteredVehicle = vehicleId ? vehicles.find((v) => v.id === vehicleId) : undefined;

  const totalPages = Math.max(1, Math.ceil(workOrders.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const rows = workOrders.slice(pageStart, pageStart + PAGE_SIZE);

  function pageHref(nextPage: number): string {
    const url = new URLSearchParams();
    if (vehicleId) url.set("vehicleId", vehicleId);
    if (openOnly) url.set("open", "1");
    if (status) url.set("status", status);
    if (nextPage > 1) url.set("page", String(nextPage));
    const query = url.toString();
    return query ? `/work-orders?${query}` : "/work-orders";
  }

  return (
    <Container className="flex flex-col gap-8 py-10">
      <PageHeader
        title="Work orders"
        crumbs={[{ label: "Maintenance" }, { label: "Work orders" }]}
      />

      <WorkOrderFilters vehicles={vehicles.map((v) => ({ id: v.id, label: v.regNumber }))} />

      {filteredVehicle && (
        <div className="text-body-xs text-muted flex flex-wrap items-center gap-3">
          <span>
            Filtered to{" "}
            <Link
              href={`/vehicles/${filteredVehicle.id}`}
              className="text-link font-medium hover:underline"
            >
              {filteredVehicle.regNumber}
            </Link>
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3" data-tour="work-orders-board">
        <div className="xl:col-span-2">
          <Card
            title={`${shownTotal} work order(s)${
              workOrders.length < shownTotal ? ` · showing ${workOrders.length}` : ""
            }`}
            icon={Wrench}
          >
            {workOrders.length === 0 ? (
              <p className="text-body-xs text-muted px-5 py-8">No work orders match.</p>
            ) : (
              <ul className="divide-hairline divide-y">
                {rows.map((wo) => {
                  // Show only actions valid from the current state and permitted.
                  const actions = Object.entries(WORK_ORDER_ACTIONS)
                    .filter(
                      ([, def]) =>
                        (def.from as readonly string[]).includes(wo.status) &&
                        permissions.includes(def.permission),
                    )
                    .map(([action]) => ({
                      action,
                      label: WORK_ORDER_ACTION_LABELS[action as keyof typeof WORK_ORDER_ACTIONS],
                    }));

                  return (
                    <li
                      key={wo.id}
                      className="flex flex-col gap-3 px-5 py-4"
                      data-tour="work-order-row"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col">
                          <Link href={`/work-orders/${wo.id}`} className="hover:text-ink">
                            <span className="text-body-sm text-ink font-medium">{wo.title}</span>
                          </Link>
                          <span className="text-body-xs text-muted">
                            {vehicleName(wo.vehicleId)} · {wo.priority} · {formatDate(wo.createdAt)}
                          </span>
                        </div>
                        <StatusBadge status={wo.status} />
                      </div>
                      {wo.description && (
                        <p className="text-body-xs text-muted line-clamp-2">{wo.description}</p>
                      )}
                      {actions.length > 0 && (
                        <StatusActions
                          endpoint={`/api/v1/work-orders/${wo.id}/status`}
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
                    </li>
                  );
                })}
              </ul>
            )}
            {workOrders.length > PAGE_SIZE && (
              <div className="border-hairline bg-subtle flex items-center justify-between gap-3 border-t px-4 py-2.5">
                <p className="text-data-xs text-muted">
                  Showing {pageStart + 1}–{pageStart + rows.length} of {workOrders.length}
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
          <Card title="New work order" icon={FilePlus2}>
            <div className="p-5">
              <CreateForm
                endpoint="/api/v1/work-orders"
                submitLabel="Create"
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
                    name: "title",
                    label: "Title",
                    required: true,
                    placeholder: "Replace brake pads",
                  },
                  { name: "description", label: "Description", type: "textarea" },
                  {
                    name: "priority",
                    label: "Priority",
                    type: "select",
                    required: true,
                    defaultValue: "NORMAL",
                    options: WORK_ORDER_PRIORITIES.map((p) => ({ value: p, label: p })),
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
