import Link from "next/link";
import { Droplets, Fuel, Gauge, ReceiptText } from "lucide-react";

import { AddFuelDialog } from "@/components/fuel/AddFuelDialog";
import { FuelFilters } from "@/components/fuel/FuelFilters";
import { Card } from "@/components/ui/Card";
import { CellMeta, DataTable, Td } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { consumptionByEntry, type FuelEntry } from "@/lib/domain/fuel";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { listFuelEntries } from "@/lib/repos/fuel";
import { listVehicles } from "@/lib/repos/vehicles";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS, permissionsForRoles } from "@/lib/auth/permissions";

export const metadata = { title: "Fuel" };

interface DisplayEntry extends FuelEntry {
  vehicleLabel: string;
  vehicleHref: string;
  kmPerLitre: number | null;
  measured: boolean;
}

export default async function FuelPage({
  searchParams,
}: {
  searchParams: Promise<{ vehicleId?: string }>;
}) {
  const context = await requirePagePermission(PERMISSIONS.FUEL_READ);
  const canCreate = permissionsForRoles(context.user.roles).has(PERMISSIONS.FUEL_CREATE);
  const { vehicleId } = await searchParams;

  const [entries, vehicles] = await Promise.all([listFuelEntries({ limit: 300 }), listVehicles()]);
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const vehicleOptions = vehicles
    .slice()
    .sort((a, b) => a.regNumber.localeCompare(b.regNumber))
    .map((v) => ({ id: v.id, label: v.regNumber }));

  const entriesForVehicle = vehicleId ? entries.filter((e) => e.vehicleId === vehicleId) : entries;

  // Defensible consumption: adjacent full-tank fill-ups on the same vehicle,
  // in purchase order. A fill-up without a reading breaks the chain, so the
  // figure lands on the SECOND fill-up and never spans a gap.
  const consumptionByFill = consumptionByEntry(entries);

  const rows: DisplayEntry[] = entriesForVehicle
    .map((entry) => {
      const vehicle = vehicleById.get(entry.vehicleId);
      const kmPerLitre = consumptionByFill.get(entry.id) ?? null;
      return {
        ...entry,
        vehicleLabel: vehicle?.regNumber ?? "—",
        vehicleHref: vehicle ? `/vehicles/${vehicle.id}` : "#",
        kmPerLitre,
        measured: kmPerLitre !== null,
      };
    })
    .sort((a, b) => b.transactedOn.localeCompare(a.transactedOn));

  const totalLitres = rows.reduce((sum, r) => sum + r.litres, 0);
  const totalMinor = rows.reduce((sum, r) => sum + r.totalMinor, 0);
  const measuredCount = rows.filter((r) => r.measured).length;
  const vehicleCount = new Set(rows.map((r) => r.vehicleId)).size;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Fuel"
        description="Fuel ledger. Costs are mirrored into canonical expenses; an odometer reading is optional, and efficiency is only reported from consecutive full-tank fill-ups that both carry one."
        crumbs={[{ label: "Finance & compliance" }, { label: "Fuel" }]}
        actions={<AddFuelDialog canCreate={canCreate} vehicles={vehicleOptions} />}
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          label="Entries shown"
          value={rows.length}
          icon={<Droplets aria-hidden="true" className="h-4 w-4" />}
          context={`${vehicleCount} vehicle${vehicleCount === 1 ? "" : "s"}`}
        />
        <KpiCard
          label="Volume"
          value={`${formatNumber(totalLitres)} L`}
          context="Recorded litres"
          icon={<Fuel aria-hidden="true" className="h-4 w-4" />}
        />
        <KpiCard
          label="Spend"
          value={formatMoney(totalMinor)}
          context="Mirrored into expenses"
          icon={<ReceiptText aria-hidden="true" className="h-4 w-4" />}
        />
        <KpiCard
          label="Measured efficiency"
          value={measuredCount > 0 ? `${measuredCount} fill-ups` : "—"}
          tone={measuredCount > 0 ? "success" : "default"}
          context="Segments with defensible km/l"
          icon={<Gauge aria-hidden="true" className="h-4 w-4" />}
        />
      </div>

      <Card title="Fuel ledger" icon={Fuel} flush dataTour="fuel-ledger">
        <div className="border-hairline border-b px-4 py-3">
          <FuelFilters vehicles={vehicleOptions} />
        </div>

        <DataTable
          caption="Fuel purchase ledger"
          columns={[
            { key: "date", header: "Date" },
            { key: "vehicle", header: "Vehicle" },
            { key: "odometer", header: "Odometer" },
            { key: "volume", header: "Litres" },
            { key: "price", header: "Unit price" },
            { key: "total", header: "Total" },
            { key: "tank", header: "Tank" },
            { key: "efficiency", header: "Efficiency" },
          ]}
          empty={
            <EmptyState
              icon={Fuel}
              title="No fuel entries"
              description="Fuel purchases are recorded through the operations workflow — entries appear here once recorded."
            />
          }
        >
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-subtle transition-colors">
              <Td>
                <span className="text-data text-ink">{formatDate(row.transactedOn)}</span>
                <CellMeta className="block">{row.station ?? ""}</CellMeta>
              </Td>
              <Td>
                <Link
                  href={row.vehicleHref}
                  className="text-data text-link font-medium hover:underline"
                >
                  {row.vehicleLabel}
                </Link>
              </Td>
              <Td>
                {typeof row.odometerKm === "number" ? (
                  <span className="text-data text-ink tabular-nums">
                    {row.odometerKm.toLocaleString()} km
                  </span>
                ) : (
                  <CellMeta>No reading</CellMeta>
                )}
              </Td>
              <Td>
                <span className="text-data text-ink tabular-nums">
                  {formatNumber(row.litres)} L
                </span>
              </Td>
              <Td>
                <span className="text-data text-ink tabular-nums">
                  {typeof row.unitPriceMinor === "number"
                    ? formatMoney(row.unitPriceMinor, row.currency)
                    : "—"}
                </span>
              </Td>
              <Td>
                <span className="text-data text-ink font-medium tabular-nums">
                  {formatMoney(row.totalMinor, row.currency)}
                </span>
              </Td>
              <Td>
                <span
                  className={`text-data-xs font-medium tracking-[var(--tracking-ui)] uppercase ${row.fullTank ? "text-success" : "text-muted"}`}
                >
                  {row.fullTank ? "Full" : "Partial"}
                </span>
              </Td>
              <Td>
                {row.kmPerLitre !== null ? (
                  <span className="text-data text-ink tabular-nums">
                    {formatNumber(row.kmPerLitre)} km/l
                  </span>
                ) : (
                  <CellMeta>Not measured</CellMeta>
                )}
              </Td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <p className="text-body-xs text-muted">
        Efficiency requires two consecutive full-tank fill-ups with increasing odometer readings. A
        fill-up without a reading still records its cost and litres, but it breaks the chain — later
        fill-ups are not measured rather than paired across the gap.
      </p>
    </div>
  );
}
