import { CreateForm } from "@/components/actions/CreateForm";
import { StatusActions } from "@/components/actions/StatusActions";
import { Container } from "@/components/layout/Container";
import { Card } from "@/components/ui/Card";
import { DisplayTitle } from "@/components/ui/DisplayTitle";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requireAuthContext } from "@/lib/auth/guards";
import { permissionsForRoles } from "@/lib/auth/permissions";
import { EXPENSE_ACTIONS, EXPENSE_CATEGORIES } from "@/lib/domain/expense";
import { formatMoney } from "@/lib/format";
import { listExpenses } from "@/lib/repos/expenses";
import { listWorkOrders } from "@/lib/repos/work-orders";

export const metadata = { title: "Expenses" };

const LABELS: Record<string, string> = {
  approve: "Approve",
  mark_paid: "Mark paid",
  void: "Void",
};

export default async function ExpensesPage() {
  const context = await requireAuthContext();
  const permissions = [...permissionsForRoles(context.user.roles)];
  const canCreate = permissions.includes("expense:create");
  const canExport = permissions.includes("expense:export");
  const [expenses, workOrders] = await Promise.all([
    listExpenses({ limit: 200 }),
    listWorkOrders({ limit: 200 }),
  ]);

  const woTitle = (id: string) => {
    const wo = workOrders.find((x) => x.id === id);
    return wo ? wo.title : "—";
  };

  return (
    <Container className="flex flex-col gap-8 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Eyebrow>Finance</Eyebrow>
          <DisplayTitle size="md">Expenses</DisplayTitle>
        </div>
        {canExport && (
          <a
            href="/api/v1/expenses/export"
            className="border-strong hover:border-ink rounded-pill font-ui border px-4 py-2 text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase transition-colors"
          >
            Export CSV ↓
          </a>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card title={`${expenses.length} expense(s)`}>
            {expenses.length === 0 ? (
              <p className="text-body-xs text-muted px-5 py-8">No expenses recorded.</p>
            ) : (
              <ul className="divide-hairline divide-y">
                {expenses.map((expense) => {
                  const actions = Object.entries(EXPENSE_ACTIONS)
                    .filter(
                      ([, def]) =>
                        (def.from as readonly string[]).includes(expense.status) &&
                        permissions.includes(def.permission),
                    )
                    .map(([action]) => ({ action, label: LABELS[action] ?? action }));

                  return (
                    <li key={expense.id} className="flex flex-col gap-3 px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col">
                          <span className="text-body-sm font-medium">{expense.description}</span>
                          <span className="text-body-xs text-muted">
                            {expense.category} · {woTitle(expense.workOrderId ?? "")}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="font-heading text-heading-sm font-semibold">
                            {formatMoney(expense.amountMinor, expense.currency)}
                          </span>
                          <StatusBadge status={expense.status} />
                        </div>
                      </div>
                      {actions.length > 0 && (
                        <StatusActions
                          endpoint={`/api/v1/expenses/${expense.id}/status`}
                          actions={actions}
                          confirm={{
                            void: "Void this expense? This cannot be undone.",
                          }}
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
          <Card title="Record expense">
            <div className="p-5">
              <CreateForm
                endpoint="/api/v1/expenses"
                submitLabel="Record"
                fields={[
                  {
                    name: "workOrderId",
                    label: "Work order",
                    type: "select",
                    required: true,
                    options: workOrders.map((wo) => ({ value: wo.id, label: wo.title })),
                  },
                  {
                    name: "category",
                    label: "Category",
                    type: "select",
                    required: true,
                    options: EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c })),
                  },
                  {
                    name: "amount",
                    label: "Amount (GHS)",
                    type: "number",
                    required: true,
                    placeholder: "250.00",
                  },
                  { name: "description", label: "Description", required: true },
                ]}
              />
            </div>
          </Card>
        )}
      </div>
    </Container>
  );
}
