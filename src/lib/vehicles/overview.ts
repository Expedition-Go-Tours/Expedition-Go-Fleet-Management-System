import { computeScheduleStatus } from "@/lib/domain/maintenance";
import { formatKm, formatMoney } from "@/lib/format";
import type { MaintenanceSchedule } from "@/lib/repos/maintenance";

/*
 * Vehicle overview summary — the six facts needed to decide whether a vehicle
 * can go out, what it costs, and what is blocking it. Pure so the numbers and
 * the wording around them are testable without Firestore or React.
 */

export type OverviewTone = "default" | "accent" | "warning" | "danger";

export interface VehicleOverviewCell {
  key: "odometer" | "driver" | "next_service" | "safety" | "repairs" | "cost";
  label: string;
  value: string;
  hint?: string;
  tone?: OverviewTone;
  /** Where the underlying records live, when a screen exists for them. */
  href?: string;
}

export interface NextServiceSummary {
  value: string;
  tone: OverviewTone;
  hint: string;
}

export interface VehicleOverviewInput {
  vehicleId: string;
  odometerKm: number;
  /** Driver of the ACTIVE assignment, when one exists. */
  driverName: string | null;
  openSafetyIssues: number;
  openWorkOrders: number;
  waitingWorkOrders: number;
  nextService: NextServiceSummary;
  /** Recorded (PENDING/APPROVED) spend in pesewas. */
  costToDateMinor: number;
  expenseCount: number;
}

/**
 * The summary row. Order is deliberate: identity of the vehicle and who has
 * it → what it needs → what is blocking it → what it has cost.
 */
export function buildVehicleOverview(input: VehicleOverviewInput): VehicleOverviewCell[] {
  const expensesHref = `/expenses?vehicleId=${input.vehicleId}`;
  return [
    {
      key: "odometer",
      label: "Current odometer",
      value: formatKm(input.odometerKm),
      hint: "Latest accepted reading",
    },
    {
      key: "driver",
      label: "Driver",
      value: input.driverName ?? "Unassigned",
      tone: input.driverName ? "default" : "warning",
      hint: input.driverName ? "Active assignment" : "No active assignment — ready to assign",
    },
    {
      key: "next_service",
      label: "Next service",
      value: input.nextService.value,
      tone: input.nextService.tone,
      hint: input.nextService.hint,
    },
    {
      key: "safety",
      label: "Safety issues",
      value: input.openSafetyIssues === 0 ? "None open" : `${input.openSafetyIssues} open`,
      tone: input.openSafetyIssues > 0 ? "danger" : "default",
      hint:
        input.openSafetyIssues > 0
          ? "Safety-critical — keep off the road until closed"
          : "No safety-critical reports open",
      href: `/reports?vehicleId=${input.vehicleId}&open=1`,
    },
    {
      key: "repairs",
      label: "Active repairs",
      value: String(input.openWorkOrders),
      tone: input.waitingWorkOrders > 0 ? "warning" : "default",
      hint:
        input.waitingWorkOrders > 0
          ? `${input.waitingWorkOrders} waiting on parts`
          : input.openWorkOrders > 0
            ? "In the workshop"
            : "No open work orders",
      href: `/work-orders?vehicleId=${input.vehicleId}&open=1`,
    },
    {
      key: "cost",
      label: "Cost to date",
      value: formatMoney(input.costToDateMinor, "GHS"),
      hint: `${input.expenseCount} recorded expense${input.expenseCount === 1 ? "" : "s"}`,
      href: expensesHref,
    },
  ];
}

/**
 * Pick the single maintenance task that most deserves attention, with the
 * amount of time/distance left. Worst-of-both-metrics ranking: overdue first,
 * then due, due soon, unconfigured, and finally on schedule.
 */
export function nextServiceLabel(
  evaluated: { schedule: MaintenanceSchedule; result: ReturnType<typeof computeScheduleStatus> }[],
  odometerKm: number,
): NextServiceSummary {
  const rank = { OVERDUE: 0, DUE: 1, DUE_SOON: 2, NOT_CONFIGURED: 3, OK: 4 } as const;
  const sorted = [...evaluated]
    .filter((e) => e.result.status !== "OK")
    .sort((a, b) => rank[a.result.status] - rank[b.result.status]);
  const first = sorted[0];
  if (!first) {
    return { value: "On schedule", tone: "default", hint: "No task due in the configured windows" };
  }
  if (first.result.status === "NOT_CONFIGURED") {
    return {
      value: "Not configured",
      tone: "default",
      hint: "Some tasks lack a baseline or interval",
    };
  }
  const t = first.schedule;
  const r = first.result;
  // Remaining is negative past the due point; an overdue task reads as a
  // magnitude ("Overdue by 1,000 km"), never a negative number.
  const remaining =
    r.remainingKm !== null
      ? `${Math.abs(r.remainingKm).toLocaleString()} km`
      : r.remainingDays !== null
        ? `${Math.abs(r.remainingDays)} day${Math.abs(r.remainingDays) === 1 ? "" : "s"}`
        : null;
  return {
    value: t.taskName,
    tone: r.status === "OVERDUE" ? "danger" : r.status === "DUE" ? "accent" : "warning",
    hint: remaining
      ? `${r.status === "OVERDUE" ? "Overdue by" : "Due in"} ${remaining} (${formatKm(odometerKm)})`
      : `${r.status} — see Maintenance tab`,
  };
}
