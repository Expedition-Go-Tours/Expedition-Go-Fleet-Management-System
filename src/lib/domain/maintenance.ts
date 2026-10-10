/*
 * Preventive-maintenance schedule engine (pure, no I/O).
 *
 * One documented precedence rule: each configured limit (odometer, time) gets
 * its own state; the task state is the WORST of the configured limits
 * (OVERDUE > DUE > DUE_SOON > OK). A task is never OK while one of its limits
 * is overdue. NOT_CONFIGURED covers both "nothing set up" and "configured but
 * missing the baseline needed to compute".
 */

export const SCHEDULE_STATUSES = ["NOT_CONFIGURED", "OK", "DUE_SOON", "DUE", "OVERDUE"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export type LimitState = "OK" | "DUE_SOON" | "DUE" | "OVERDUE";

const SEVERITY: Record<LimitState, number> = { OK: 0, DUE_SOON: 1, DUE: 2, OVERDUE: 3 };

export interface ScheduleInput {
  /** km between services, when distance-based. */
  intervalKm?: number | null;
  /** Days between services, when time-based. */
  intervalDays?: number | null;
  /** Warning threshold before the due odometer (e.g. 500 km). */
  dueSoonKm?: number | null;
  /** Warning threshold before the due date (days). */
  dueSoonDays?: number | null;
  /** Baseline: odometer at the last completed service. */
  lastServiceOdometerKm?: number | null;
  /** Baseline: date of the last completed service. */
  lastServiceDate?: Date | null;
  /** Latest accepted odometer projection. */
  currentOdometerKm?: number | null;
  /** "Now" — injected so calculations are testable. */
  now: Date;
}

export interface ScheduleResult {
  status: ScheduleStatus;
  /** Calculated due points, null when not computable. */
  nextDueOdometerKm: number | null;
  nextDueDate: Date | null;
  /** Remaining before the due point (negative = past due). */
  remainingKm: number | null;
  remainingDays: number | null;
  /** Per-limit states, null when that limit is not configured/computable. */
  odometerState: LimitState | null;
  timeState: LimitState | null;
  /** False when a configured limit lacked its baseline (setup incomplete). */
  computed: boolean;
  /** Human-readable explanation of NOT_CONFIGURED/incomplete states. */
  note?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function odometerLimitState(
  current: number,
  due: number,
  dueSoonKm: number,
): { state: LimitState; remaining: number } {
  const remaining = due - current;
  if (current > due) return { state: "OVERDUE", remaining };
  if (current === due) return { state: "DUE", remaining };
  if (current >= due - dueSoonKm) return { state: "DUE_SOON", remaining };
  return { state: "OK", remaining };
}

function utcDayStart(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function timeLimitState(
  now: Date,
  dueDate: Date,
  dueSoonDays: number,
): { state: LimitState; remaining: number } {
  // Day precision: comparisons happen on UTC calendar days, so a task due
  // today is DUE (not OVERDUE) until the day ends.
  const nowDay = utcDayStart(now);
  const dueDay = utcDayStart(dueDate);
  const remainingDays = Math.round((dueDay - nowDay) / DAY_MS);
  if (nowDay > dueDay) return { state: "OVERDUE", remaining: remainingDays };
  if (nowDay === dueDay) return { state: "DUE", remaining: 0 };
  if (remainingDays <= dueSoonDays) return { state: "DUE_SOON", remaining: remainingDays };
  return { state: "OK", remaining: remainingDays };
}

function worst(a: LimitState | null, b: LimitState | null): LimitState | null {
  if (a === null) return b;
  if (b === null) return a;
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

/**
 * Compute a schedule's status from its configured intervals, baselines and
 * the vehicle's current state.
 */
export function computeScheduleStatus(input: ScheduleInput): ScheduleResult {
  const hasOdometerLimit = typeof input.intervalKm === "number" && input.intervalKm > 0;
  const hasTimeLimit = typeof input.intervalDays === "number" && input.intervalDays > 0;

  const result: ScheduleResult = {
    status: "NOT_CONFIGURED",
    nextDueOdometerKm: null,
    nextDueDate: null,
    remainingKm: null,
    remainingDays: null,
    odometerState: null,
    timeState: null,
    computed: false,
  };

  if (!hasOdometerLimit && !hasTimeLimit) {
    result.note = "No service interval configured for this task";
    return result;
  }

  let incomplete = "";

  if (hasOdometerLimit) {
    if (typeof input.lastServiceOdometerKm !== "number") {
      incomplete = "baseline odometer missing";
    } else if (typeof input.currentOdometerKm !== "number") {
      incomplete = "current odometer missing";
    } else {
      const due = input.lastServiceOdometerKm + (input.intervalKm as number);
      const { state, remaining } = odometerLimitState(
        input.currentOdometerKm,
        due,
        typeof input.dueSoonKm === "number" ? input.dueSoonKm : 0,
      );
      result.nextDueOdometerKm = due;
      result.remainingKm = remaining;
      result.odometerState = state;
    }
  }

  if (hasTimeLimit) {
    if (!(input.lastServiceDate instanceof Date) || Number.isNaN(input.lastServiceDate.getTime())) {
      incomplete = incomplete
        ? `${incomplete}, last service date missing`
        : "last service date missing";
    } else {
      const dueDate = new Date(
        input.lastServiceDate.getTime() + (input.intervalDays as number) * DAY_MS,
      );
      const { state, remaining } = timeLimitState(
        input.now,
        dueDate,
        typeof input.dueSoonDays === "number" ? input.dueSoonDays : 0,
      );
      result.nextDueDate = dueDate;
      result.remainingDays = remaining;
      result.timeState = state;
    }
  }

  const overall = worst(result.odometerState, result.timeState);
  if (overall === null) {
    result.note = `Cannot calculate due point: ${incomplete}`;
    return result;
  }

  result.computed = true;
  result.status = overall;
  if (incomplete) {
    result.note = `Partially configured: ${incomplete}`;
  }
  return result;
}
