import { ChevronLeft, ChevronRight, FilePlus2, ReceiptText } from "lucide-react";

import { CreateForm } from "@/components/actions/CreateForm";
import { StatusActions } from "@/components/actions/StatusActions";
import { ExpenseFilters } from "@/components/expenses/ExpenseFilters";
import { Container } from "@/components/layout/Container";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { permissionsForRoles, PERMISSIONS } from "@/lib/auth/permissions";
import { EXPENSE_ACTIONS, EXPENSE_CATEGORIES } from "@/lib/domain/expense";
import { formatMoney, humanizeEnum } from "@/lib/format";
import { listExpenses, countExpenses } from "@/lib/repos/expenses";
import { listVehicles } from "@/lib/repos/vehicles";
import { listWorkOrders } from "@/lib/repos/work-orders";
import Link from "next/link";

export const metadata = { title: "Expenses" };

const LABELS: Record<string, string> = {
  void: "Void",
};

const PAGE_SIZE = 20;

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; vehicleId?: string; page?: string }>;
}) {
  const context = await requirePagePermission(PERMISSIONS.EXPENSE_READ);
  const permissions = [...permissionsForRoles(context.user.roles)];
  const canCreate = permissions.includes("expense:create");
  const canExport = permissions.includes("expense:export");

  const params = await searchParams;
  const category = params.category?.trim() || undefined;
  const vehicleId = params.vehicleId?.trim() || undefined;
  const pageRaw = Number(params.page);
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const [expenses, workOrders, vehicles, expenseTotal] = await Promise.all([
    listExpenses({ category, vehicleId, limit: 500 }),
    listWorkOrders({ limit: 200 }),
    listVehicles(),
    countExpenses({ vehicleId }),
  ]);

  const totalPages = Math.max(1, Math.ceil(expenses.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const rows = expenses.slice(pageStart, pageStart + PAGE_SIZE);

  function pageHref(nextPage: number): string {
    const url = new URLSearchParams();
    if (category) url.set("category", category);
    if (vehicleId) url.set("vehicleId", vehicleId);
    if (nextPage > 1) url.set("page", String(nextPage));
    const query = url.toString();
    return query ? `/expenses?${query}` : "/expenses";
  }

  const vehicleName = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    return v ? v.regNumber : "—";
  };
  const woTitle = (id: string | undefined) => {
    if (!id) return null;
    const wo = workOrders.find((x) => x.id === id);
    return wo ? wo.title : "—";
  };

  return (
    <Container className="flex flex-col gap-8 py-10">
      <PageHeader
        title="Expenses"
        crumbs={[{ label: "Finance & compliance" }, { label: "Expenses" }]}
        dataTour="expense-header"
        actions={
          canExport ? (
            <a
              href="/api/v1/expenses/export"
              data-tour="expense-export"
              className="border-strong hover:border-ink rounded-pill font-ui border px-4 py-2 text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase transition-colors"
            >
              Export CSV ↓
            </a>
          ) : undefined
        }
      />

      <ExpenseFilters vehicles={vehicles.map((v) => ({ id: v.id, label: v.regNumber }))} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card
            dataTour="expense-ledger"
            title={`${expenseTotal} expense(s)${
              expenses.length < expenseTotal ? ` · showing ${expenses.length}` : ""
            }`}
            icon={ReceiptText}
          >
            {expenses.length === 0 ? (
              <p className="text-body-xs text-muted px-5 py-8">No expenses recorded.</p>
            ) : (
              <ul className="divide-hairline divide-y">
                {rows.map((expense) => {
                  const actions = Object.entries(EXPENSE_ACTIONS)
                    .filter(
                      ([, def]) =>
                        (def.from as readonly string[]).includes(expense.status) &&
                        permissions.includes(def.permission),
                    )
                    .map(([action]) => ({ action, label: LABELS[action] ?? action }));
                  const workOrderLabel = woTitle(expense.workOrderId);

                  return (
                    <li key={expense.id} className="flex flex-col gap-3 px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col">
                          <span className="text-body-sm font-medium">{expense.description}</span>
                          <span className="text-body-xs text-muted">
                            <Link
                              href={`/vehicles/${expense.vehicleId}`}
                              className="text-link font-medium hover:underline"
                            >
                              {vehicleName(expense.vehicleId)}
                            </Link>{" "}
                            · {humanizeEnum(expense.category)}
                            {workOrderLabel ? ` · ${workOrderLabel}` : ""}
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
                            void: "Void this expense? The record is kept but excluded from totals.",
                          }}
                          reason={{
                            void: {
                              label: "Reason for voiding",
                              required: true,
                              placeholder: "Duplicate of another entry",
                            },
                          }}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {expenses.length > PAGE_SIZE && (
              <div className="border-hairline bg-subtle flex items-center justify-between gap-3 border-t px-4 py-2.5">
                <p className="text-data-xs text-muted">
                  Showing {pageStart + 1}–{pageStart + rows.length} of {expenses.length}
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
          <Card title="Record expense" icon={FilePlus2} dataTour="expense-create">
            <div className="p-5">
              <CreateForm
                endpoint="/api/v1/expenses"
                submitLabel="Record"
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
                    name: "workOrderId",
                    label: "Work order (optional)",
                    type: "select",
                    options: workOrders.map((wo) => ({
                      value: wo.id,
                      label: `${wo.number ? `${wo.number} — ` : ""}${wo.title}`,
                    })),
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
                    step: "0.01",
                  },
                  { name: "description", label: "Description", required: true },
                  {
                    name: "supplierName",
                    label: "Supplier (optional)",
                    placeholder: "Kofi Auto Parts",
                  },
                  {
                    name: "incurredOn",
                    label: "Date incurred (optional)",
                    type: "date",
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
