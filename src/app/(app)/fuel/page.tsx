import Link from "next/link";
import { Droplets, Fuel, Gauge, ReceiptText } from "lucide-react";

import { FuelFilters } from "@/components/fuel/FuelFilters";
import { Card } from "@/components/ui/Card";
import { CellMeta, DataTable, Td } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { computeConsumption, type FuelEntry } from "@/lib/domain/fuel";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { listFuelEntries } from "@/lib/repos/fuel";
import { listVehicles } from "@/lib/repos/vehicles";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";

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
  await requirePagePermission(PERMISSIONS.FUEL_READ);
  const { vehicleId } = await searchParams;

  const [entries, vehicles] = await Promise.all([listFuelEntries({ limit: 300 }), listVehicles()]);
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));

  const entriesForVehicle = vehicleId ? entries.filter((e) => e.vehicleId === vehicleId) : entries;

  // Defensible consumption: only consecutive full-tank fill-ups on the same
  // vehicle, in odometer order. The figure lands on the SECOND fill-up.
  const consumptionByEntry = new Map<string, number>();
  const byVehicle = new Map<string, FuelEntry[]>();
  for (const entry of entries) {
    const list = byVehicle.get(entry.vehicleId) ?? [];
    list.push(entry);
    byVehicle.set(entry.vehicleId, list);
  }
  for (const list of byVehicle.values()) {
    const ordered = list.slice().sort((a, b) => a.odometerKm - b.odometerKm);
    for (let i = 0; i < ordered.length - 1; i++) {
      const first = ordered[i]!;
      const second = ordered[i + 1]!;
      const result = computeConsumption(first, second);
      if (result.kmPerLitre !== null) consumptionByEntry.set(second.id, result.kmPerLitre);
    }
  }

  const rows: DisplayEntry[] = entriesForVehicle
    .map((entry) => {
      const vehicle = vehicleById.get(entry.vehicleId);
      const kmPerLitre = consumptionByEntry.get(entry.id) ?? null;
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
        description="Fuel ledger. Costs are mirrored into the canonical expense records; efficiency is only reported from consecutive full-tank fill-ups."
        crumbs={[{ label: "Finance & compliance" }, { label: "Fuel" }]}
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard label="Entries shown" value={rows.length} icon={<Droplets aria-hidden="true" className="h-4 w-4" />} context={`${vehicleCount} vehicle${vehicleCount === 1 ? "" : "s"}`} />
        <KpiCard label="Volume" value={`${formatNumber(totalLitres)} L`} context="Recorded litres" icon={<Fuel aria-hidden="true" className="h-4 w-4" />} />
        <KpiCard label="Spend" value={formatMoney(totalMinor)} context="Mirrored into expenses" icon={<ReceiptText aria-hidden="true" className="h-4 w-4" />} />
        <KpiCard
          label="Measured efficiency"
          value={measuredCount > 0 ? `${measuredCount} fill-ups` : "—"}
          tone={measuredCount > 0 ? "success" : "default"}
          context="Segments with defensible km/l"
          icon={<Gauge aria-hidden="true" className="h-4 w-4" />}
        />
      </div>

      <Card title="Fuel ledger" icon={Fuel} flush>
        <div className="border-hairline border-b px-4 py-3">
          <FuelFilters
            vehicles={vehicles
              .slice()
              .sort((a, b) => a.regNumber.localeCompare(b.regNumber))
              .map((v) => ({ id: v.id, label: v.regNumber }))}
          />
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
                <Link href={row.vehicleHref} className="text-data font-medium text-link hover:underline">
                  {row.vehicleLabel}
                </Link>
              </Td>
              <Td>
                <span className="text-data tabular-nums text-ink">
                  {row.odometerKm.toLocaleString()} km
                </span>
              </Td>
              <Td>
                <span className="text-data tabular-nums text-ink">
                  {formatNumber(row.litres)} L
                </span>
              </Td>
              <Td>
                <span className="text-data tabular-nums text-ink">
                  {typeof row.unitPriceMinor === "number"
                    ? formatMoney(row.unitPriceMinor, row.currency)
                    : "—"}
                </span>
              </Td>
              <Td>
                <span className="text-data tabular-nums font-medium text-ink">
                  {formatMoney(row.totalMinor, row.currency)}
                </span>
              </Td>
              <Td>
                <span className={`text-data-xs font-medium uppercase tracking-[var(--tracking-ui)] ${row.fullTank ? "text-success" : "text-muted"}`}>
                  {row.fullTank ? "Full" : "Partial"}
                </span>
              </Td>
              <Td>
                {row.kmPerLitre !== null ? (
                  <span className="text-data tabular-nums text-ink">
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
        Efficiency requires two consecutive full-tank fill-ups with increasing odometer readings —
        anything less reports &ldquo;not measured&rdquo; rather than an unreliable figure.
      </p>
    </div>
  );
}