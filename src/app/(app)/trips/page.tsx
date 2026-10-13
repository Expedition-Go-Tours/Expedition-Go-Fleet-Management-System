import Link from "next/link";
import { Filter, Search } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { TripList } from "@/components/trips/TripList";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS, permissionsForRoles } from "@/lib/auth/permissions";
import { TRIP_STATUSES, TRIP_PURPOSES, getTripDistanceMetres } from "@/lib/domain/trip";
import type { Trip } from "@/lib/domain/trip";
import { humanizeEnum } from "@/lib/format";
import { listTripsPaginated } from "@/lib/repos/trips";
import { listVehicles } from "@/lib/repos/vehicles";
import { listUsers } from "@/lib/repos/users";

export const metadata = { title: "Trips" };

const PAGE_SIZE = 25;

export default async function TripsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const context = await requirePagePermission(PERMISSIONS.TRIP_READ);
  const params = await searchParams;
  const permissions = [...permissionsForRoles(context.user.roles)];
  const canReadAll = permissions.includes(PERMISSIONS.TRIP_READ_ALL);

  // Server-side filters
  const vehicleFilter = params.vehicle ?? undefined;
  const driverFilter = canReadAll ? (params.driver ?? undefined) : context.user.id;
  const dateFilter = params.date ?? undefined;
  const statusFilter = params.status ?? undefined;
  const purposeFilter = params.purpose ?? undefined;
  const searchQuery = params.q?.trim().toLowerCase() ?? "";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  // Fetch trips with server-side pagination + lookups
  const [tripResult, vehicles, users] = await Promise.all([
    listTripsPaginated({
      vehicleId: vehicleFilter,
      driverUserId: driverFilter,
      tripDate: dateFilter,
      status: statusFilter as Trip["status"] | undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    listVehicles(),
    canReadAll ? listUsers() : Promise.resolve([]),
  ]);

  // Apply client-side filters (purpose, text search) on the current page
  let pageTrips = tripResult.trips;
  if (purposeFilter) {
    pageTrips = pageTrips.filter((t) => t.purpose === purposeFilter);
  }
  if (searchQuery) {
    pageTrips = pageTrips.filter(
      (t) =>
        t.origin.label.toLowerCase().includes(searchQuery) ||
        t.destination.label.toLowerCase().includes(searchQuery) ||
        (t.externalReference ?? "").toLowerCase().includes(searchQuery) ||
        (t.notes ?? "").toLowerCase().includes(searchQuery),
    );
  }

  const totalCount = tripResult.total;
  const totalPages = tripResult.totalPages;

  // Summary metrics for the current page
  const completedTrips = pageTrips.filter((t) => t.status === "COMPLETED");
  const totalDistanceM = completedTrips.reduce((sum, t) => {
    const m = getTripDistanceMetres(t);
    return sum + (m ?? 0);
  }, 0);
  const staleRoutes = pageTrips.filter((t) => t.routeStale).length;
  const missingDistance = pageTrips.filter(
    (t) => t.status === "COMPLETED" && getTripDistanceMetres(t) === null,
  ).length;

  const vehicleOptions = vehicles.map((v) => ({ id: v.id, label: v.regNumber }));
  const driverOptions = users.map((u) => ({ id: u.id, label: u.name }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Trips"
        description="Operations trip register — all recorded journeys across the fleet."
        crumbs={[{ label: "Overview", href: "/" }, { label: "Trips" }]}
      />

      {/* Summary metrics */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard label="Total trips" value={totalCount} />
        <MetricCard label="Total distance" value={`${(totalDistanceM / 1000).toFixed(1)} km`} />
        <MetricCard label="Stale routes" value={staleRoutes} />
        <MetricCard label="Missing distance" value={missingDistance} />
      </div>

      {/* Filters */}
      <Card>
        <form className="flex flex-wrap items-end gap-3 px-5 py-4">
          <div className="min-w-[180px] flex-1">
            <label className="field-label mb-1 block">Search</label>
            <div className="relative">
              <Search className="text-muted absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
              <input
                type="text"
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="Origin, destination, reference…"
                className="field-control w-full pl-8"
              />
            </div>
          </div>
          <div>
            <label className="field-label mb-1 block">Date</label>
            <input
              type="date"
              name="date"
              defaultValue={dateFilter ?? ""}
              className="field-control"
            />
          </div>
          <div>
            <label className="field-label mb-1 block">Status</label>
            <select name="status" defaultValue={statusFilter ?? ""} className="field-control">
              <option value="">All</option>
              {TRIP_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanizeEnum(s)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label mb-1 block">Purpose</label>
            <select name="purpose" defaultValue={purposeFilter ?? ""} className="field-control">
              <option value="">All</option>
              {TRIP_PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {humanizeEnum(p)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label mb-1 block">Vehicle</label>
            <select name="vehicle" defaultValue={vehicleFilter ?? ""} className="field-control">
              <option value="">All</option>
              {vehicleOptions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          {canReadAll && (
            <div>
              <label className="field-label mb-1 block">Driver</label>
              <select name="driver" defaultValue={driverFilter ?? ""} className="field-control">
                <option value="">All</option>
                {driverOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button type="submit" className="btn-secondary">
            <Filter className="mr-1 inline h-4 w-4" /> Filter
          </button>
        </form>
      </Card>

      {/* Trip list */}
      <Card>
        <TripList
          trips={pageTrips}
          emptyMessage={
            totalCount === 0 ? "No trips match your filters." : "No trips on this page."
          }
        />
        {totalPages > 1 && (
          <div className="border-hairline flex items-center justify-between border-t px-5 py-3">
            <p className="text-body-xs text-muted">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of{" "}
              {totalCount}
            </p>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={`?${buildParams(params, page - 1)}`} className="btn-secondary">
                  Previous
                </Link>
              )}
              {page < totalPages && (
                <Link href={`?${buildParams(params, page + 1)}`} className="btn-secondary">
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-hairline rounded-lg border px-4 py-3">
      <p className="text-data-xs text-muted">{label}</p>
      <p className="text-body-sm text-ink font-semibold">{value}</p>
    </div>
  );
}

function buildParams(params: Record<string, string | undefined>, page: number): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) sp.set(key, value);
  }
  sp.set("page", String(page));
  return sp.toString();
}
