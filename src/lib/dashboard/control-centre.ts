/*
 * Fleet control-centre aggregation (server-only).
 *
 * Every number is derived at request time from Firestore through the repos —
 * never hardcoded, never a stale cron label. Calculation rules:
 *
 *  - Fleet: non-archived vehicles split by status; "available" = ACTIVE **and**
 *    no safety hold **and** no open critical issue **and** no active assignment;
 *    "in use" = ACTIVE vehicles with an active assignment.
 *  - Maintenance health: every schedule is evaluated live with the vehicle's
 *    current accepted odometer and the real `lastServiceDate` (Date), so
 *    time-based tasks are counted like distance tasks.
 *  - Priority queue: critical safety issues > safety holds > overdue maintenance
 *    > missing/expired mandatory documents > waiting work orders.
 *  - Expenses shown are RECORDED (unvoided) only; money stays integer pesewas.
 *
 * Query strategy matches every other list page (per-collection equality filters
 * + in-memory aggregation — no composite indexes).
 */

import type { PermissionKey } from "@/lib/auth/permissions";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { summariseFleet, type FleetSummary } from "@/lib/dashboard/fleet-summary";
import { computeScheduleStatus, type ScheduleStatus } from "@/lib/domain/maintenance";
import { documentState, DOCUMENT_CATEGORIES } from "@/lib/domain/document";
import { listAssignments } from "@/lib/repos/assignments";
import { listDocuments } from "@/lib/repos/documents";
import { listExpenses } from "@/lib/repos/expenses";
import { listSchedules } from "@/lib/repos/maintenance";
import { listIssues } from "@/lib/repos/reports";
import { listVehicles } from "@/lib/repos/vehicles";
import { listWorkOrders } from "@/lib/repos/work-orders";
import type { MaintenanceReport } from "@/lib/domain/report";

export type { FleetSummary };

export interface MaintenanceHealth {
  evaluated: number;
  overdue: number;
  due: number;
  dueSoon: number;
  notConfigured: number;
  openWorkOrders: number;
  waitingWorkOrders: number;
}

export interface ActionItem {
  /** Stable, unique key for React lists (entity id, not display text). */
  id: string;
  kind:
    "critical_issue" | "safety_hold" | "overdue_maintenance" | "document" | "waiting_work_order";
  title: string;
  details: string;
  href: string;
  tone: "danger" | "warning" | "accent";
}

export interface ControlCentre {
  asOf: string;
  fleet?: FleetSummary;
  maintenance?: MaintenanceHealth;
  queue: ActionItem[];
  /** Open issues by severity (unprivileged users see only their own). */
  issuesBySeverity?: { severity: string; count: number }[];
  /** RECORDED expenses this calendar month. */
  monthExpenses?: { count: number; totalMinor: number };
}

const EXPIRY_WARNING_DAYS = Number(process.env.DOCUMENT_EXPIRY_WARNING_DAYS ?? 30);

const OPEN_WORK_ORDER_STATUSES = new Set(["OPEN", "IN_PROGRESS", "WAITING"]);

function scheduleTone(status: ScheduleStatus): "danger" | "warning" | "accent" | null {
  if (status === "OVERDUE") return "danger";
  if (status === "DUE") return "accent";
  if (status === "DUE_SOON") return "warning";
  return null;
}

export async function loadControlCentre(input: {
  userId: string;
  permissions: string[];
}): Promise<ControlCentre> {
  const permissions = new Set<string>(input.permissions) as Set<PermissionKey>;
  const now = new Date();
  const result: ControlCentre = { asOf: now.toISOString(), queue: [] };

  const canReadVehicles = permissions.has(PERMISSIONS.VEHICLE_READ);
  const canReadAllReports = permissions.has(PERMISSIONS.REPORT_READ_ALL);
  const canReadSchedules = permissions.has(PERMISSIONS.SCHEDULE_READ);
  const canReadDocuments = permissions.has(PERMISSIONS.DOCUMENT_READ);
  const canReadExpenses = permissions.has(PERMISSIONS.EXPENSE_READ);
  const canReadWorkOrders = permissions.has(PERMISSIONS.WORK_ORDER_READ);

  if (!canReadVehicles) {
    // Permitted users only see their own open issues.
    const myIssues = canReadAllReports
      ? []
      : await listIssues({ reportedBy: input.userId, limit: 200 });
    const myOpen = myIssues.filter((i) => i.status !== "CLOSED");
    result.issuesBySeverity = countBySeverity(myOpen);
    return result;
  }

  const [
    vehicles,
    activeAssignments,
    openIssuesAll,
    triagedIssuesAll,
    openCritical,
    triagedCritical,
    workOrders,
    expenses,
  ] = await Promise.all([
    listVehicles(),
    listAssignments({ status: "ACTIVE", limit: 500 }),
    canReadAllReports ? listIssues({ status: "OPEN", limit: 500 }) : [],
    canReadAllReports ? listIssues({ status: "TRIAGED", limit: 500 }) : [],
    canReadAllReports ? listIssues({ safetyCritical: true, status: "OPEN", limit: 200 }) : [],
    canReadAllReports ? listIssues({ safetyCritical: true, status: "TRIAGED", limit: 200 }) : [],
    canReadWorkOrders ? listWorkOrders({ limit: 500 }) : [],
    canReadExpenses ? listExpenses({ status: "RECORDED", limit: 500 }) : [],
  ]);

  const fleetVehicles = vehicles.filter((v) => v.status !== "ARCHIVED");
  const activeVehicleIds = new Set(activeAssignments.map((a) => a.vehicleId));

  // Open critical issue vehicle ids, restricted to the interrogated fleet.
  const criticalOpenIds = new Set<string>(
    [...openCritical, ...triagedCritical].map((i) => i.vehicleId),
  );

  // Shared with the vehicles-list drill-down so the KPI and its link agree.
  result.fleet = summariseFleet(fleetVehicles, activeVehicleIds, criticalOpenIds);

  // ---- Maintenance health + overdue queue items ---------------------------
  if (canReadSchedules) {
    const health: MaintenanceHealth = {
      evaluated: 0,
      overdue: 0,
      due: 0,
      dueSoon: 0,
      notConfigured: 0,
      openWorkOrders: workOrders.filter((wo) => OPEN_WORK_ORDER_STATUSES.has(wo.status)).length,
      waitingWorkOrders: workOrders.filter((wo) => wo.status === "WAITING").length,
    };
    const overdueItems: { id: string; title: string; details: string; href: string }[] = [];

    for (const vehicle of fleetVehicles) {
      const schedules = await listSchedules(vehicle.id);
      for (const schedule of schedules) {
        health.evaluated += 1;
        const evaluated = computeScheduleStatus({
          intervalKm: schedule.intervalKm,
          intervalDays: schedule.intervalDays,
          dueSoonKm: schedule.dueSoonKm,
          dueSoonDays: schedule.dueSoonDays,
          lastServiceOdometerKm: schedule.lastServiceOdometerKm,
          lastServiceDate: schedule.lastServiceDate,
          currentOdometerKm: vehicle.odometerKm,
          now,
        });
        if (evaluated.status === "OVERDUE") health.overdue += 1;
        else if (evaluated.status === "DUE") health.due += 1;
        else if (evaluated.status === "DUE_SOON") health.dueSoon += 1;
        else if (evaluated.status === "NOT_CONFIGURED") health.notConfigured += 1;

        if (evaluated.status === "OVERDUE") {
          overdueItems.push({
            id: `maint-${vehicle.id}-${schedule.id}`,
            title: `${vehicle.regNumber} · ${schedule.taskName}`,
            details: `Overdue by ${evaluated.remainingKm != null ? `${evaluated.remainingKm.toLocaleString()} km` : evaluated.remainingDays != null ? `${evaluated.remainingDays} day${evaluated.remainingDays === 1 ? "" : "s"}` : "date"}`,
            href: `/vehicles/${vehicle.id}?tab=maintenance`,
          });
        }
      }
    }
    result.maintenance = health;

    for (const item of overdueItems.slice(0, 5)) {
      result.queue.push({
        id: item.id,
        kind: "overdue_maintenance",
        title: item.title,
        details: item.details,
        href: item.href,
        tone: "danger",
      });
    }
  }

  // ---- Priority queue: critical issues + safety holds ----------------------
  const criticalIssues = [...openCritical, ...triagedCritical];
  const vehicleName = new Map(vehicles.map((v) => [v.id, v.regNumber]));
  for (const issue of criticalIssues.slice(0, 5)) {
    result.queue.push({
      id: `issue-${issue.id}`,
      kind: "critical_issue",
      title: issue.title,
      details: `Critical · ${issue.number ?? "Issue"} · ${vehicleName.get(issue.vehicleId) ?? "vehicle"}`,
      href: `/reports/${issue.id}`,
      tone: "danger",
    });
  }
  for (const vehicle of fleetVehicles.filter((v) => v.status === "SAFETY_HOLD").slice(0, 5)) {
    result.queue.push({
      id: `hold-${vehicle.id}`,
      kind: "safety_hold",
      title: `${vehicle.regNumber} on safety hold`,
      details: vehicle.safetyHoldReason || "Release requires explicit vehicle:release permission.",
      href: `/vehicles/${vehicle.id}`,
      tone: "danger",
    });
  }

  // ---- Mandatory document health (only when documents are readable) --------
  if (canReadDocuments) {
    interface DocFinding {
      id: string;
      title: string;
      details: string;
      href: string;
    }
    const docFindings: { missing: DocFinding[]; expired: DocFinding[] } = {
      missing: [],
      expired: [],
    };

    for (const vehicle of fleetVehicles) {
      const documents = await listDocuments(vehicle.id);
      for (const doc of documents) {
        if (!doc.mandatory) continue;
        const state = documentState(doc, now, EXPIRY_WARNING_DAYS);
        if (state === "MISSING") {
          docFindings.missing.push({
            id: `doc-${vehicle.id}-${doc.id}`,
            title: `${vehicle.regNumber} · ${docCategoryLabel(doc.category)}`,
            details: "Required document not on record",
            href: `/vehicles/${vehicle.id}?tab=documents`,
          });
        } else if (state === "EXPIRED") {
          docFindings.expired.push({
            id: `doc-${vehicle.id}-${doc.id}`,
            title: `${vehicle.regNumber} · ${docCategoryLabel(doc.category)}`,
            details: "Expired and must be renewed before assignment",
            href: `/vehicles/${vehicle.id}?tab=documents`,
          });
        }
      }
    }

    for (const item of [...docFindings.missing, ...docFindings.expired].slice(0, 5)) {
      result.queue.push({
        id: item.id,
        kind: "document",
        title: item.title,
        details: item.details,
        href: item.href,
        tone: "warning",
      });
    }
  }

  // ---- Waiting work orders --------------------------------------------------
  if (canReadWorkOrders) {
    for (const wo of workOrders.filter((w) => w.status === "WAITING").slice(0, 3)) {
      result.queue.push({
        id: `wo-${wo.id}`,
        kind: "waiting_work_order",
        title: wo.title,
        details: `${wo.number} · waiting: ${wo.waitingReason ?? "awaiting parts or provider"}`,
        href: `/work-orders/${wo.id}`,
        tone: "warning",
      });
    }
  }
  result.queue.sort((a, b) => priorityOf(a.kind) - priorityOf(b.kind));

  // ---- Open issues by severity (audience-aware) ------------------------------
  if (canReadAllReports) {
    const merged = new Map<string, MaintenanceReport>();
    for (const issue of openIssuesAll) merged.set(issue.id, issue);
    for (const issue of triagedIssuesAll) merged.set(issue.id, issue);
    result.issuesBySeverity = countBySeverity([...merged.values()]);
  } else {
    const mine = await listIssues({ reportedBy: input.userId, limit: 200 });
    result.issuesBySeverity = countBySeverity(mine.filter((i) => i.status !== "CLOSED"));
  }

  // ---- RECORDED expenses this calendar month ----------------------------------
  if (canReadExpenses) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const recorded = expenses.filter((e) => e.incurredOn >= monthStart);
    result.monthExpenses = {
      count: recorded.length,
      totalMinor: recorded.reduce((sum, e) => sum + e.amountMinor, 0),
    };
  }

  return result;
}

function priorityOf(kind: ActionItem["kind"]): number {
  switch (kind) {
    case "critical_issue":
      return 0;
    case "safety_hold":
      return 1;
    case "overdue_maintenance":
      return 2;
    case "document":
      return 3;
    case "waiting_work_order":
      return 4;
  }
}

function countBySeverity(issues: MaintenanceReport[]): { severity: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    counts.set(issue.severity, (counts.get(issue.severity) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([severity, count]) => ({ severity, count }))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export function docCategoryLabel(category: string): string {
  return (DOCUMENT_CATEGORIES.includes(category as never) ? category : category)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export { scheduleTone };
