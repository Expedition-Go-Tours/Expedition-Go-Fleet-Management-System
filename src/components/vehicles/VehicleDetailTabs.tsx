"use client";

import { useState } from "react";

import { StatusBadge } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/cn";

/*
 * Tabbed vehicle detail view. The server page pre-fetches and pre-formats
 * every section (dates as strings); this component only switches panels.
 * All formatting stays presentation-only — the API remains the source of truth.
 */

export interface TabOverviewData {
  odometerKm: number;
  odometerAt: string;
  createdBy: string;
  createdAt: string;
  archivedAt: string;
  safetyHoldReason: string | null | undefined;
  safetyHoldAppliedAt: string;
}

export interface TabReadingData {
  km: number;
  source: string;
  status: string;
  deltaKm: number | null;
  effectiveAt: string;
  note: string;
}

export interface TabScheduleData {
  taskName: string;
  status: string;
  intervalKm: number | null;
  lastServiceKm: number | null;
  lastServiceDate: string;
  nextDueKm: string;
}

export interface TabServiceRecordData {
  taskName: string;
  completedAt: string;
  odometerKm: number | null;
  workOrderId: string | null;
  workPerformed: string | null;
}

export interface TabIssueData {
  number: string;
  title: string;
  severity: string;
  status: string;
  createdAt: string;
}

export interface TabWorkOrderData {
  number: string;
  title: string;
  priority: string;
  status: string;
  createdAt: string;
}

export interface TabAssignmentData {
  driverName: string;
  purpose: string;
  status: string;
  startKm: number | null;
  endKm: number | null;
  distanceKm: number | null;
  createdAt: string;
}

export interface TabFuelData {
  transactedOn: string;
  litres: number;
  amountMinor: number;
  odometerKm: number;
}

export interface TabDocumentData {
  category: string;
  status: string;
  expiryDate: string;
  mandatory: boolean;
  notes: string | null;
}

export interface VehicleDetailTabData {
  overview: TabOverviewData;
  readings: TabReadingData[];
  schedules: TabScheduleData[];
  serviceRecords: TabServiceRecordData[];
  issues: TabIssueData[];
  workOrders: TabWorkOrderData[];
  assignments: TabAssignmentData[];
  fuelEntries: TabFuelData[];
  documents: TabDocumentData[];
}

const TABS = [
  "Overview",
  "Odometer",
  "Maintenance",
  "Service",
  "Issues",
  "Work orders",
  "Assignments",
  "Fuel",
  "Documents",
] as const;

type TabKey = (typeof TABS)[number];

function Empty({ label }: { label: string }) {
  return <p className="text-body-xs text-muted px-5 py-6">{label}</p>;
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-2.5">
      <span className="font-ui text-muted text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
        {label}
      </span>
      <span className="text-body-sm text-right">{value}</span>
    </div>
  );
}

function KeyValueList({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <div className="divide-hairline divide-y">
      {items.map(([label, value]) => (
        <Row key={label} label={label} value={value} />
      ))}
    </div>
  );
}

export function VehicleDetailTabs({ data }: { data: VehicleDetailTabData }) {
  const [tab, setTab] = useState<TabKey>("Overview");

  return (
    <div className="flex flex-col gap-4">
      <div className="border-hairline flex flex-wrap gap-1 border-y">
        {TABS.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => setTab(label)}
            className={cn(
              "font-ui text-muted hover:text-ink px-3 py-2 text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase transition-colors",
              tab === label && "border-accent text-ink border-b-2 -mb-px",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-1">
            <KeyValueList
              items={[
                ["Current odometer", `${data.overview.odometerKm.toLocaleString()} km`],
                ["Last reading at", data.overview.odometerAt],
                ["Held since", data.overview.safetyHoldAppliedAt],
                ["Archived at", data.overview.archivedAt],
                ["Registered", data.overview.createdAt],
                ["Created by", data.overview.createdBy],
              ]}
            />
          </div>
          <div className="flex flex-col gap-1">
            {data.overview.safetyHoldReason ? (
              <div className="border-error/25 bg-error/10 rounded-md border p-4">
                <p className="font-ui text-error text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
                  Safety hold reason
                </p>
                <p className="text-body-sm mt-1">{data.overview.safetyHoldReason}</p>
              </div>
            ) : (
              <div className="border-hairline rounded-md border p-4">
                <p className="font-ui text-muted text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
                  No safety hold
                </p>
                <p className="text-body-sm text-muted mt-1">Vehicle is not restricted.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "Odometer" && (
        <div className="border-hairline rounded-md border">
          {data.readings.length === 0 ? (
            <Empty label="No odometer readings recorded." />
          ) : (
            <ul className="divide-hairline divide-y">
              {data.readings.map((r) => (
                <li key={`${r.effectiveAt}-${r.km}`} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body-sm font-medium">
                      {r.km.toLocaleString()} km
                    </span>
                    {r.deltaKm !== null && (
                      <span className="text-body-xs text-muted">+{r.deltaKm.toLocaleString()} km</span>
                    )}
                    <StatusBadge status={r.status} />
                    <span className="font-ui text-muted ml-auto text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
                      {r.source}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-3">
                    <span className="text-body-xs text-muted">
                      {r.effectiveAt}
                      {r.note ? ` — ${r.note}` : ""}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "Maintenance" && (
        <div className="border-hairline rounded-md border">
          {data.schedules.length === 0 ? (
            <Empty label="No maintenance schedules configured." />
          ) : (
            <ul className="divide-hairline divide-y">
              {data.schedules.map((s) => (
                <li key={s.taskName} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body-sm font-medium">{s.taskName}</span>
                    <StatusBadge status={s.status} />
                  </div>
                  <div className="text-body-xs text-muted mt-1">
                    interval {s.intervalKm ? `${s.intervalKm.toLocaleString()} km` : "time-based"}
                    {" · "}next due {s.nextDueKm}
                    {" · "}last service{" "}
                    {s.lastServiceKm !== null ? `${s.lastServiceKm.toLocaleString()} km` : "—"}
                    {s.lastServiceDate !== "—" ? ` on ${s.lastServiceDate}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "Service" && (
        <div className="border-hairline rounded-md border">
          {data.serviceRecords.length === 0 ? (
            <Empty label="No completed service records." />
          ) : (
            <ul className="divide-hairline divide-y">
              {data.serviceRecords.map((s) => (
                <li key={`${s.completedAt}-${s.taskName}`} className="px-5 py-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-body-sm font-medium">{s.taskName}</span>
                    <span className="text-body-xs text-muted ml-auto">
                      {s.completedAt}
                      {s.odometerKm !== null ? ` · ${s.odometerKm.toLocaleString()} km` : ""}
                    </span>
                  </div>
                  {s.workPerformed && (
                    <p className="text-body-xs text-muted mt-1">{s.workPerformed}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "Issues" && (
        <div className="border-hairline rounded-md border">
          {data.issues.length === 0 ? (
            <Empty label="No reported issues." />
          ) : (
            <ul className="divide-hairline divide-y">
              {data.issues.map((i) => (
                <li key={i.number} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-body-sm truncate">
                      {i.number ? `${i.number} — ` : ""}
                      {i.title}
                    </span>
                    <span className="text-body-xs text-muted">
                      {i.severity} · {i.createdAt}
                    </span>
                  </div>
                  <StatusBadge status={i.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "Work orders" && (
        <div className="border-hairline rounded-md border">
          {data.workOrders.length === 0 ? (
            <Empty label="No work orders." />
          ) : (
            <ul className="divide-hairline divide-y">
              {data.workOrders.map((w) => (
                <li key={w.number} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-body-sm truncate">
                      {w.number ? `${w.number} — ` : ""}
                      {w.title}
                    </span>
                    <span className="text-body-xs text-muted">
                      {w.priority} · {w.createdAt}
                    </span>
                  </div>
                  <StatusBadge status={w.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "Assignments" && (
        <div className="border-hairline rounded-md border">
          {data.assignments.length === 0 ? (
            <Empty label="No assignments." />
          ) : (
            <ul className="divide-hairline divide-y">
              {data.assignments.map((a) => (
                <li key={`${a.createdAt}-${a.driverName}`} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body-sm font-medium">{a.driverName}</span>
                    <StatusBadge status={a.status} />
                    <span className="font-ui text-muted ml-auto text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
                      {a.purpose.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="text-body-xs text-muted mt-1">
                    start {a.startKm !== null ? `${a.startKm.toLocaleString()} km` : "—"}
                    {" · "}end {a.endKm !== null ? `${a.endKm.toLocaleString()} km` : "—"}
                    {a.distanceKm !== null ? ` · trip ${a.distanceKm.toLocaleString()} km` : ""}
                    {" · "}
                    {a.createdAt}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "Fuel" && (
        <div className="border-hairline rounded-md border">
          {data.fuelEntries.length === 0 ? (
            <Empty label="No fuel entries." />
          ) : (
            <ul className="divide-hairline divide-y">
              {data.fuelEntries.map((f) => (
                <li key={`${f.transactedOn}-${f.odometerKm}`} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-body-sm font-medium">
                      {f.litres.toLocaleString()} L
                    </span>
                    <span className="text-body-xs text-muted">
                      {f.transactedOn} · {f.odometerKm.toLocaleString()} km
                    </span>
                  </div>
                  <span className="text-body-sm tabular-nums">
                    {(f.amountMinor / 100).toLocaleString("en-US", {
                      style: "currency",
                      currency: "GHS",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "Documents" && (
        <div className="border-hairline rounded-md border">
          {data.documents.length === 0 ? (
            <Empty label="No documents attached." />
          ) : (
            <ul className="divide-hairline divide-y">
              {data.documents.map((d) => (
                <li key={`${d.category}-${d.expiryDate}`} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-body-sm capitalize">
                      {d.category.toLowerCase()}
                      {d.mandatory ? " · mandatory" : ""}
                    </span>
                    <span className="text-body-xs text-muted">
                      {d.expiryDate !== "—" ? `expires ${d.expiryDate}` : "no expiry"}
                      {d.notes ? ` · ${d.notes}` : ""}
                    </span>
                  </div>
                  <StatusBadge status={d.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}