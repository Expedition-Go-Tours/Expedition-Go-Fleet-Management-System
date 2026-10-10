import Link from "next/link";
import { ChevronLeft, ChevronRight, Car } from "lucide-react";

import { TableSort } from "@/components/ui/TableSort";
import { AddVehicleDialog } from "@/components/vehicles/AddVehicleDialog";
import { VehicleFilters } from "@/components/vehicles/VehicleFilters";
import { Card } from "@/components/ui/Card";
import { CellMeta, DataTable, Td } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requireAuthContext } from "@/lib/auth/guards";
import { permissionsForRoles, PERMISSIONS } from "@/lib/auth/permissions";
import type { Vehicle } from "@/lib/domain/vehicle";
import { VEHICLE_STATUSES, VEHICLE_TYPES } from "@/lib/domain/vehicle";
import { formatKm } from "@/lib/format";

export const metadata = { title: "Vehicles" };

const PAGE_SIZE = 20;
const BASE_PATH = "/vehicles";

type SortKey = "createdAt" | "regNumber" | "odometerKm" | "year";
const SORT_KEYS: SortKey[] = ["createdAt", "regNumber", "odometerKm", "year"];

interface Params {
  q?: string;
  status?: string;
  type?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const context = await requireAuthContext();
  const permissions = [...permissionsForRoles(context.user.roles)];
  const canCreate = permissions.includes(PERMISSIONS.VEHICLE_CREATE);

  const params = await searchParams;
  const q = (params.q ?? "").trim().toLowerCase();
  const status = (params.status ?? "").toUpperCase();
  const type = (params.type ?? "").toUpperCase();
  const sort: SortKey = SORT_KEYS.includes(params.sort as SortKey) ? (params.sort as SortKey) : "createdAt";
  const dir = params.dir === "asc" ? "asc" : "desc";
  const pageRaw = Number(params.page);
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const { listVehicles } = await import("@/lib/repos/vehicles");
  const vehicles = await listVehicles();

  const filtered = vehicles
    .filter((v) => (status && VEHICLE_STATUSES.includes(status as never) ? v.status === status : true))
    .filter((v) => (type && VEHICLE_TYPES.includes(type as never) ? v.type === type : true))
    .filter((v) =>
      q ? [v.regNumber, v.make, v.model, String(v.year)].join(" ").toLowerCase().includes(q) : true,
    )
    .sort((a, b) => compareVehicles(a, b, sort, dir));

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const rows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  function pageHref(nextPage: number): string {
    const url = new URLSearchParams();
    if (q) url.set("q", q);
    if (status) url.set("status", status);
    if (type) url.set("type", type);
    if (params.sort) url.set("sort", params.sort);
    if (params.dir) url.set("dir", params.dir);
    if (nextPage > 1) url.set("page", String(nextPage));
    const query = url.toString();
    return query ? `${BASE_PATH}?${query}` : BASE_PATH;
  }

  const columns = [
    { key: "vehicle", header: "Vehicle" },
    { key: "type", header: "Type" },
    { key: "year", header: <TableSort label="Year" sortKey="year" basePath={BASE_PATH} /> },
    { key: "odometer", header: <TableSort label="Odometer" sortKey="odometerKm" basePath={BASE_PATH} /> },
    { key: "status", header: <TableSort label="Status" sortKey="regNumber" basePath={BASE_PATH} /> },
    { key: "chevron", header: "", className: "w-10" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Vehicles"
        description={`${filtered.length} vehicle${filtered.length === 1 ? "" : "s"} in the fleet.`}
        crumbs={[{ label: "Fleet" }, { label: "Vehicles" }]}
        actions={<AddVehicleDialog canCreate={canCreate} />}
      />

      <VehicleFilters />

      <Card flush>
        {rows.length === 0 ? (
          <EmptyState
            icon={Car}
            title={q || status || type ? "No vehicles match your filters" : "No vehicles registered yet"}
            description={
              q || status || type
                ? "Try clearing the search or changing the filters."
                : "Register your first vehicle to start the odometer ledger."
            }
            action={q || status || type ? <ClearFiltersLink /> : undefined}
          />
        ) : (
          <DataTable
            columns={columns}
            caption="Vehicles"
            footer={
              <div className="flex items-center justify-between gap-3">
                <p className="text-data-xs text-muted">
                  Showing {pageStart + 1}–{pageStart + rows.length} of {filtered.length}
                </p>
                <div className="flex items-center gap-1">
                  <PagerLink href={pageHref(safePage - 1)} disabled={safePage <= 1} label="Previous page" icon={<ChevronLeft aria-hidden="true" className="h-4 w-4" />} />
                  <span className="text-data-xs px-2 text-muted">
                    Page {safePage} of {totalPages}
                  </span>
                  <PagerLink href={pageHref(safePage + 1)} disabled={safePage >= totalPages} label="Next page" icon={<ChevronRight aria-hidden="true" className="h-4 w-4" />} />
                </div>
              </div>
            }
          >
            {rows.map((vehicle) => (
              <tr key={vehicle.id} className="hover:bg-subtle transition-colors">
                <Td>
                  <Link href={`/vehicles/${vehicle.id}`} className="block outline-none">
                    <span className="flex flex-col">
                      <span className="text-data font-semibold text-ink">{vehicle.regNumber}</span>
                      <span className="text-data-xs text-muted">
                        {vehicle.make} {vehicle.model}
                      </span>
                    </span>
                  </Link>
                </Td>
                <Td>
                  <CellMeta>{vehicle.type}</CellMeta>
                </Td>
                <Td>
                  <CellMeta>{vehicle.year}</CellMeta>
                </Td>
                <Td>
                  <span className="text-data tabular-nums text-ink">{formatKm(vehicle.odometerKm)}</span>
                  {vehicle.odometerSource && (
                    <CellMeta className="block">
                      via {vehicle.odometerSource.replace(/_/g, " ").toLowerCase()}
                    </CellMeta>
                  )}
                </Td>
                <Td>
                  <StatusBadge status={vehicle.status} />
                </Td>
                <Td>
                  <Link
                    href={`/vehicles/${vehicle.id}`}
                    aria-label={`Open ${vehicle.regNumber}`}
                    className="hover:bg-subtle text-faint hover:text-ink flex h-8 w-8 items-center justify-center rounded-md"
                  >
                    <ChevronRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <p className="text-body-xs text-muted">
        Odometer figures are the current accepted projection of each vehicle&apos;s readings ledger
        (see the vehicle&apos;s Odometer tab for the full history).
      </p>
    </div>
  );
}

function compareVehicles(a: Vehicle, b: Vehicle, sort: SortKey, dir: "asc" | "desc"): number {
  const factor = dir === "asc" ? 1 : -1;
  switch (sort) {
    case "regNumber":
      return a.regNumber.localeCompare(b.regNumber) * factor;
    case "odometerKm":
      return (a.odometerKm - b.odometerKm) * factor;
    case "year":
      return (a.year - b.year) * factor;
    default:
      return (a.createdAt.getTime() - b.createdAt.getTime()) * factor;
  }
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
      <span className="text-faint flex h-8 w-8 items-center justify-center rounded-md" aria-disabled="true">
        {icon}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className="hover:bg-subtle hover:text-ink text-muted flex h-8 w-8 items-center justify-center rounded-md border border-hairline bg-surface transition-colors"
    >
      {icon}
    </Link>
  );
}

function ClearFiltersLink() {
  return (
    <Link
      href="/vehicles"
      className="hover:bg-subtle inline-flex h-9 items-center rounded-md border border-hairline bg-surface px-3 text-sm font-medium text-ink"
    >
      Clear filters
    </Link>
  );
}