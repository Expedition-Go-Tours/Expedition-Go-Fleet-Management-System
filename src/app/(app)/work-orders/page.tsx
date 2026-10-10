import { CreateForm } from "@/components/actions/CreateForm";
import { StatusActions } from "@/components/actions/StatusActions";
import { Container } from "@/components/layout/Container";
import { Card } from "@/components/ui/Card";
import { DisplayTitle } from "@/components/ui/DisplayTitle";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requireAuthContext } from "@/lib/auth/guards";
import { permissionsForRoles } from "@/lib/auth/permissions";
import { WORK_ORDER_ACTIONS, WORK_ORDER_PRIORITIES } from "@/lib/domain/work-order";
import { formatDate } from "@/lib/format";
import { listVehicles } from "@/lib/repos/vehicles";
import { listWorkOrders } from "@/lib/repos/work-orders";
import Link from "next/link";

export const metadata = { title: "Work orders" };

const LABELS: Record<string, string> = {
  start: "Start",
  complete: "Mark complete",
  close: "Close",
  reopen: "Reopen",
};

export default async function WorkOrdersPage() {
  const context = await requireAuthContext();
  const permissions = [...permissionsForRoles(context.user.roles)];
  const canCreate = permissions.includes("work_order:create");
  const [workOrders, vehicles] = await Promise.all([
    listWorkOrders({ limit: 100 }),
    listVehicles(),
  ]);

  const vehicleName = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    return v ? v.regNumber : "—";
  };

  return (
    <Container className="flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-2">
        <Eyebrow>Repairs</Eyebrow>
        <DisplayTitle size="md">Work orders</DisplayTitle>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card title={`${workOrders.length} work order(s)`}>
            {workOrders.length === 0 ? (
              <p className="text-body-xs text-muted px-5 py-8">No work orders yet.</p>
            ) : (
              <ul className="divide-hairline divide-y">
                {workOrders.map((wo) => {
                  // Show only actions valid from the current state and permitted.
                  const actions = Object.entries(WORK_ORDER_ACTIONS)
                    .filter(
                      ([, def]) =>
                        (def.from as readonly string[]).includes(wo.status) &&
                        permissions.includes(def.permission),
                    )
                    .map(([action]) => ({ action, label: LABELS[action] ?? action }));

                  return (
                    <li key={wo.id} className="flex flex-col gap-3 px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col">
                          <Link href={`/work-orders/${wo.id}`} className="hover:text-ink">
                            <span className="text-body-sm font-medium text-ink">{wo.title}</span>
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
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        {canCreate && (
          <Card title="New work order">
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
