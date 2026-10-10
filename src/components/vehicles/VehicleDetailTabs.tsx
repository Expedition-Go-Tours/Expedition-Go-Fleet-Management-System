"use client";

import Link from "next/link";
import { FileWarning, Wrench } from "lucide-react";

import { StatusBadge, StatusDot, formatStatusLabel } from "@/components/ui/StatusBadge";
import { Tabs } from "@/components/ui/Tabs";

/*
 * Tabbed vehicle profile. The server page pre-fetches and pre-formats every
 * section; this component only switches panels and renders connected rows —
 * every record links to its own detail route (issue, work order, documents,
 * fuel) so operators can click through the audit trail.
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
  id: string;
  taskName: string;
  status: string;
  category: string;
  intervalKm: number | null;
  intervalDays: number | null;
  enabled: boolean;
  lastServiceKm: number | null;
  lastServiceDate: string;
  nextDueKm: string;
  nextDueDate: string;
  remainingKm: number | null;
  remainingDays: number | null;
}

export interface TabServiceRecordData {
  id: string;
  taskName: string;
  completedAt: string;
  odometerKm: number | null;
  workOrderId: string | null;
  workPerformed: string | null;
}

export interface TabIssueData {
  id: string;
  number: string;
  title: string;
  severity: string;
  status: string;
  createdAt: string;
}

export interface TabWorkOrderData {
  id: string;
  number: string;
  title: string;
  priority: string;
  status: string;
  createdAt: string;
}

export interface TabAssignmentData {
  id: string;
  driverName: string;
  purpose: string;
  status: string;
  startKm: number | null;
  endKm: number | null;
  distanceKm: number | null;
  createdAt: string;
}

export interface TabFuelData {
  id: string;
  transactedOn: string;
  litres: number;
  amountMinor: number;
  currency: string;
  odometerKm: number;
  fullTank: boolean;
}

export interface TabDocumentData {
  id: string;
  category: string;
  /** Domain-computed state: VALID / EXPIRING_SOON / EXPIRED / MISSING. */
  state: string;
  hasFile: boolean;
  mandatory: boolean;
  expiryDate: string;
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

function Empty({ label }: { label: string }) {
  return <p className="text-body-xs text-muted px-5 py-6">{label}</p>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-2.5">
      <span className="font-ui text-data-xs font-medium uppercase tracking-[var(--tracking-ui)] text-muted">
        {label}
      </span>
      <span className="text-data text-right text-ink">{value}</span>
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

function PanelHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-hairline bg-subtle font-ui border-b px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[var(--tracking-ui)] text-muted">
      {children}
    </p>
  );
}

export function VehicleDetailTabs({ data }: { data: VehicleDetailTabData }) {
  const tabs = [
    {
      id: "overview",
      label: "Overview",
      panel: <OverviewPanel data={data} />,
    },
    { id: "odometer", label: "Odometer", panel: <OdometerPanel readings={data.readings} /> },
    { id: "maintenance", label: "Maintenance", panel: <MaintenancePanel schedules={data.schedules} /> },
    { id: "service", label: "Service", panel: <ServicePanel records={data.serviceRecords} /> },
    {
      id: "issues",
      label: "Issues",
      badge: <CountBadge count={data.issues.length} />,
      panel: <IssuesPanel issues={data.issues} />,
    },
    {
      id: "work-orders",
      label: "Work orders",
      badge: <CountBadge count={data.workOrders.length} />,
      panel: <WorkOrdersPanel workOrders={data.workOrders} />,
    },
    { id: "assignments", label: "Assignments", panel: <AssignmentsPanel assignments={data.assignments} /> },
    { id: "fuel", label: "Fuel", panel: <FuelPanel entries={data.fuelEntries} /> },
    {
      id: "documents",
      label: "Documents",
      badge: <CountBadge count={data.documents.length} />,
      panel: <DocumentsPanel documents={data.documents} />,
    },
  ];

  return <Tabs tabs={tabs} initial="overview" />;
}

function CountBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="bg-subtle border-hairline text-data-xs rounded-full border px-1.5 text-muted">
      {count}
    </span>
  );
}

function OverviewPanel({ data }: { data: VehicleDetailTabData }) {
  return (
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
      <div className="flex flex-col gap-3">
        {data.overview.safetyHoldReason ? (
          <div className="border-error/25 bg-error/10 rounded-md border p-4">
            <p className="font-ui text-error text-[10px] uppercase tracking-[var(--tracking-ui)]">
              Safety hold reason
            </p>
            <p className="text-body-sm mt-1 text-ink">{data.overview.safetyHoldReason}</p>
          </div>
        ) : (
          <div className="border-hairline rounded-md border p-4">
            <p className="font-ui text-data-xs text-muted uppercase tracking-[var(--tracking-ui)]">
              No safety hold
            </p>
            <p className="text-body-xs text-muted mt-1">Vehicle is not restricted.</p>
          </div>
        )}
        {data.overview.odometerAt === "—" && (
          <p className="border-warning/25 bg-warning/10 text-body-xs rounded-md border p-3 text-warning">
            No odometer reading recorded yet — record a baseline on the Odometer tab.
          </p>
        )}
        {/* Record counts — quick profile at a glance. */}
        <div className="border-hairline grid grid-cols-3 divide-x divide-hairline rounded-md border">
          <ProfileStat label="Open issues" value={data.issues.filter((i) => i.status !== "CLOSED").length} href="/reports" />
          <ProfileStat label="Work orders" value={data.workOrders.filter((w) => ["OPEN", "IN_PROGRESS", "WAITING"].includes(w.status)).length} href="/work-orders" />
          <ProfileStat label="Documents" value={data.documents.length} href="/documents" />
        </div>
      </div>
    </div>
  );
}

function ProfileStat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="hover:bg-subtle flex flex-col items-center gap-0.5 px-2 py-3 transition-colors">
      <span className="font-heading text-heading-md font-semibold tabular-nums text-ink">{value}</span>
      <span className="font-ui text-[10px] uppercase tracking-[var(--tracking-ui)] text-muted">{label}</span>
    </Link>
  );
}

function OdometerPanel({ readings }: { readings: TabReadingData[] }) {
  return (
    <div className="border-hairline rounded-md border">
      {readings.length === 0 ? (
        <Empty label="No odometer readings recorded." />
      ) : (
        <ul className="divide-hairline divide-y">
          {readings.map((r) => (
            <li key={`${r.effectiveAt}-${r.km}`} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-data font-medium text-ink">{r.km.toLocaleString()} km</span>
                {r.deltaKm !== null && (
                  <span className="text-data-xs text-muted">+{r.deltaKm.toLocaleString()} km</span>
                )}
                <StatusBadge status={r.status} />
                <span className="font-ui text-data-xs ml-auto uppercase tracking-[var(--tracking-ui)] text-muted">
                  {r.source.replace(/_/g, " ")}
                </span>
              </div>
              <div className="text-data-xs mt-1 text-muted">
                {r.effectiveAt}
                {r.note ? ` — ${r.note}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MaintenancePanel({ schedules }: { schedules: TabScheduleData[] }) {
  return (
    <div className="border-hairline rounded-md border">
      {schedules.length === 0 ? (
        <Empty label="No maintenance schedules configured." />
      ) : (
        <ul className="divide-hairline divide-y">
          {schedules.map((s) => (
            <li key={s.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-data font-medium text-ink">{s.taskName}</span>
                <StatusBadge status={s.status} />
                {!s.enabled && (
                  <span className="text-data-xs text-muted">· disabled</span>
                )}
              </div>
              <div className="text-data-xs mt-1 text-muted">
                {intervalLabel(s.intervalKm, s.intervalDays)} · last service{" "}
                {s.lastServiceKm !== null ? `${s.lastServiceKm.toLocaleString()} km` : "—"}
                {s.lastServiceDate !== "—" ? ` on ${s.lastServiceDate}` : ""}
              </div>
              <div className="text-data-xs mt-0.5 text-ink">
                {s.status === "NOT_CONFIGURED" ? (
                  <span className="text-muted">Not due yet — needs a service baseline to evaluate.</span>
                ) : (
                  <>
                    Next due {s.nextDueKm !== "—" ? `${s.nextDueKm}` : ""}
                    {s.nextDueDate !== "—" ? ` or ${s.nextDueDate}` : ""}
                    {s.remainingKm !== null && (
                      <span className={remainingTone(s.status)}> · {s.remainingKm.toLocaleString()} km remaining</span>
                    )}
                    {s.remainingDays !== null && (
                      <span className={remainingTone(s.status)}> · {s.remainingDays} day{s.remainingDays === 1 ? "" : "s"} remaining</span>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function intervalLabel(km: number | null, days: number | null): string {
  if (km && days) return `every ${km.toLocaleString()} km or ${days} days`;
  if (km) return `every ${km.toLocaleString()} km`;
  if (days) return `every ${days} days`;
  return "interval not configured";
}

function remainingTone(status: string): string {
  if (status === "OVERDUE") return "font-medium text-error";
  if (status === "DUE") return "font-medium text-accent";
  if (status === "DUE_SOON") return "font-medium text-warning";
  return "text-muted";
}

function ServicePanel({ records }: { records: TabServiceRecordData[] }) {
  return (
    <div className="border-hairline rounded-md border">
      {records.length === 0 ? (
        <Empty label="No completed service records." />
      ) : (
        <ul className="divide-hairline divide-y">
          {records.map((s) => {
            const inner = (
              <>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-data font-medium text-ink">{s.taskName}</span>
                  <span className="text-data-xs ml-auto text-muted">
                    {s.completedAt}
                    {s.odometerKm !== null ? ` · ${s.odometerKm.toLocaleString()} km` : ""}
                  </span>
                </div>
                {s.workPerformed && <p className="text-data-xs mt-1 text-muted">{s.workPerformed}</p>}
                {s.workOrderId && (
                  <p className="text-data-xs mt-1 font-medium text-link">
                    <Link href={`/work-orders/${s.workOrderId}`} className="hover:underline">
                      View linked work order →
                    </Link>
                  </p>
                )}
              </>
            );
            return (
              <li key={s.id} className="px-5 py-3">
                {inner}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function IssuesPanel({ issues }: { issues: TabIssueData[] }) {
  return (
    <div className="border-hairline rounded-md border">
      <PanelHeader>Reported defects — open items first</PanelHeader>
      {issues.length === 0 ? (
        <Empty label="No reported issues." />
      ) : (
        <ul className="divide-hairline divide-y">
          {issues.map((issue) => (
            <li key={issue.id}>
              <Link href={`/reports/${issue.id}`} className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-subtle">
                <div className="flex min-w-0 flex-col">
                  <span className="text-data flex items-center gap-2 font-medium text-ink">
                    <FileWarning aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-faint" />
                    <span className="truncate">{issue.title}</span>
                  </span>
                  <span className="text-data-xs mt-0.5 pl-5.5 text-muted">
                    {issue.number ? `${issue.number} · ` : ""}
                    {formatStatusLabel(issue.severity)} · {issue.createdAt}
                  </span>
                </div>
                <StatusBadge status={issue.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WorkOrdersPanel({ workOrders }: { workOrders: TabWorkOrderData[] }) {
  return (
    <div className="border-hairline rounded-md border">
      <PanelHeader>Repair and service orders — open first</PanelHeader>
      {workOrders.length === 0 ? (
        <Empty label="No work orders." />
      ) : (
        <ul className="divide-hairline divide-y">
          {workOrders.map((wo) => (
            <li key={wo.id}>
              <Link href={`/work-orders/${wo.id}`} className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-subtle">
                <div className="flex min-w-0 flex-col">
                  <span className="text-data flex items-center gap-2 font-medium text-ink">
                    <Wrench aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-faint" />
                    <span className="truncate">{wo.title}</span>
                  </span>
                  <span className="text-data-xs mt-0.5 pl-5.5 text-muted">
                    {wo.number ? `${wo.number} · ` : ""}
                    {formatStatusLabel(wo.priority)} · {wo.createdAt}
                  </span>
                </div>
                <StatusBadge status={wo.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AssignmentsPanel({ assignments }: { assignments: TabAssignmentData[] }) {
  return (
    <div className="border-hairline rounded-md border">
      {assignments.length === 0 ? (
        <Empty label="No assignments." />
      ) : (
        <ul className="divide-hairline divide-y">
          {assignments.map((a) => (
            <li key={a.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-data font-medium text-ink">{a.driverName}</span>
                <StatusBadge status={a.status} />
                <span className="font-ui text-data-xs ml-auto uppercase tracking-[var(--tracking-ui)] text-muted">
                  {a.purpose.replace(/_/g, " ")}
                </span>
              </div>
              <div className="text-data-xs mt-1 text-muted">
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
  );
}

function FuelPanel({ entries }: { entries: TabFuelData[] }) {
  return (
    <div className="border-hairline rounded-md border">
      {entries.length === 0 ? (
        <Empty label="No fuel entries." />
      ) : (
        <ul className="divide-hairline divide-y">
          {entries.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="flex min-w-0 flex-col">
                <span className="text-data font-medium text-ink">
                  {f.litres.toLocaleString()} L
                  {f.fullTank ? <span className="text-data-xs ml-1.5 text-muted">(full tank)</span> : null}
                </span>
                <span className="text-data-xs text-muted">
                  {f.transactedOn} · {f.odometerKm.toLocaleString()} km
                </span>
              </div>
              <span className="text-data tabular-nums text-ink">{formatMoney(f.amountMinor, f.currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DocumentsPanel({ documents }: { documents: TabDocumentData[] }) {
  return (
    <div className="border-hairline rounded-md border">
      {documents.length === 0 ? (
        <Empty label="No documents attached." />
      ) : (
        <ul className="divide-hairline divide-y">
          {documents.map((d) => {
            const label =
              d.state === "MISSING" && d.hasFile ? "Awaiting replacement" : formatStatusLabel(d.state);
            return (
              <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 flex-col">
                  <span className="text-data flex items-center gap-2 font-medium capitalize text-ink">
                    {d.category.toLowerCase()}
                    {d.mandatory ? (
                      <span className="font-ui text-data-xs text-muted uppercase"> · required</span>
                    ) : null}
                  </span>
                  <span className="text-data-xs mt-0.5 text-muted">
                    {d.expiryDate !== "—" ? `expires ${d.expiryDate}` : "no expiry"}
                    {d.hasFile ? "" : d.expiryDate !== "—" ? " · no file uploaded" : " · no file uploaded"}
                    {d.notes ? ` · ${d.notes}` : ""}
                  </span>
                </div>
                <StatusDot status={label} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatMoney(amountMinor: number, currency: string): string {
  const symbols: Record<string, string> = { GHS: "GH₵", USD: "$", EUR: "€" };
  const symbol = symbols[currency] ?? `${currency} `;
  return `${symbol}${(amountMinor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}