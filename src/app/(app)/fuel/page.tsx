import Link from "next/link";
import { Droplets, Fuel, Gauge, ReceiptText } from "lucide-react";

import { AddFuelDialog } from "@/components/fuel/AddFuelDialog";
import { EditFuelDialog } from "@/components/fuel/EditFuelDialog";
import { FuelFilters } from "@/components/fuel/FuelFilters";
import { Card } from "@/components/ui/Card";
import { CellMeta, DataTable, Td } from "@/components/ui/DataTable";
import { DeleteRecordDialog } from "@/components/ui/DeleteRecordDialog";
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
  const permissions = permissionsForRoles(context.user.roles);
  const canCreate = permissions.has(PERMISSIONS.FUEL_CREATE);
  const canEdit = permissions.has(PERMISSIONS.FUEL_UPDATE);
  const canDelete = permissions.has(PERMISSIONS.FUEL_DELETE);
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

  const totalLitres = rows.reduce((sum, r) => sum + (r.litres ?? 0), 0);
  const litreCount = rows.filter((r) => typeof r.litres === "number").length;
  const totalMinor = rows.reduce((sum, r) => sum + r.totalMinor, 0);
  const measuredCount = rows.filter((r) => r.measured).length;
  const vehicleCount = new Set(rows.map((r) => r.vehicleId)).size;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Fuel"
        description="Fuel ledger. Record the amount paid; the odometer is optional and the cost is mirrored into the expense ledger."
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
          value={litreCount > 0 ? `${formatNumber(totalLitres)} L` : "—"}
          context={litreCount > 0 ? `Across ${litreCount} fill-ups with litres` : "Not recorded"}
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
            { key: "paidTo", header: "Paid to" },
            { key: "odometer", header: "Odometer" },
            { key: "price", header: "Unit price" },
            { key: "total", header: "Total" },
            { key: "tank", header: "Tank" },
            ...(canEdit || canDelete
              ? [{ key: "actions", header: "Actions", className: "text-right" }]
              : []),
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
                {row.paidTo ? (
                  <span className="text-data text-ink">{row.paidTo}</span>
                ) : (
                  <CellMeta>—</CellMeta>
                )}
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
              {(canEdit || canDelete) && (
                <Td className="text-right">
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    {canEdit && (
                      <EditFuelDialog
                        entry={{
                          id: row.id,
                          vehicleLabel: row.vehicleLabel,
                          transactedOn: row.transactedOn,
                          totalMinor: row.totalMinor,
                          currency: row.currency,
                          fuelType: row.fuelType,
                          station: row.station,
                          paidTo: row.paidTo,
                          fullTank: row.fullTank,
                          odometerKm: row.odometerKm,
                        }}
                      />
                    )}
                    {canDelete && (
                      <DeleteRecordDialog
                        endpoint={`/api/v1/fuel/${row.id}`}
                        recordLabel={`${row.vehicleLabel} — ${formatMoney(
                          row.totalMinor,
                          row.currency,
                        )} on ${formatDate(row.transactedOn)}`}
                        description="This permanently removes the fuel purchase. The action cannot be undone."
                        details={[
                          ...(row.expenseId
                            ? ["The canonical expense for this purchase is deleted too."]
                            : []),
                          ...(row.odometerReadingId
                            ? [
                                "The odometer reading is kept as mileage history; only its fuel link is cleared.",
                              ]
                            : []),
                        ]}
                      />
                    )}
                  </div>
                </Td>
              )}
            </tr>
          ))}
        </DataTable>
      </Card>
    </div>
  );
}
