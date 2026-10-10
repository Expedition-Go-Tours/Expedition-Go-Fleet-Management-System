/*
 * Odometer ledger domain logic (pure, no I/O).
 *
 * The ledger is the historical record of mileage observations; the vehicle's
 * `odometerKm` field is only a projection of the highest ACCEPTED reading.
 * Normal readings must never decrease. Lower values are only reachable via the
 * correction workflow, which supersedes (never deletes) the original.
 */

export const ODOMETER_SOURCES = [
  "PRE_TRIP_INSPECTION",
  "POST_TRIP_INSPECTION",
  "TRIP_START",
  "TRIP_END",
  "FUEL_PURCHASE",
  "SERVICE_COMPLETION",
  "MANUAL_ENTRY",
  "HISTORICAL_IMPORT",
] as const;
export type OdometerSource = (typeof ODOMETER_SOURCES)[number];

/** Sources that represent a live, forward-moving observation. */
const LIVE_SOURCES: readonly OdometerSource[] = [
  "PRE_TRIP_INSPECTION",
  "POST_TRIP_INSPECTION",
  "TRIP_START",
  "TRIP_END",
  "FUEL_PURCHASE",
  "SERVICE_COMPLETION",
  "MANUAL_ENTRY",
];

export const ODOMETER_STATUSES = ["ACCEPTED", "FLAGGED", "SUPERSEDED"] as const;
export type OdometerStatus = (typeof ODOMETER_STATUSES)[number];

export interface OdometerReading {
  id: string;
  vehicleId: string;
  /** Whole kilometres. */
  km: number;
  /** When the physical reading was taken (may differ from createdAt for imports). */
  effectiveAt: Date;
  /** Server-side creation time. */
  createdAt: Date;
  /** Authenticated employee who submitted the reading. */
  recordedByUserId: string;
  source: OdometerSource;
  /** Related record ids, when the reading came from an event. */
  assignmentId?: string;
  inspectionId?: string;
  serviceRecordId?: string;
  fuelEntryId?: string;
  issueId?: string;
  notes?: string;
  status: OdometerStatus;
  /** km gained versus the previous accepted reading, when computable. */
  deltaKm?: number;
  /** Correction metadata — present on superseded originals and replacements. */
  correctedReadingId?: string;
  correctedByUserId?: string;
  correctionReason?: string;
  /** Original reading this entry replaces (for correction replacements). */
  supersedesReadingId?: string;
  /** Set when a historical import conflicts with neighbouring readings. */
  conflictNote?: string;
  /** Client-supplied idempotency token. */
  clientToken?: string;
}

/** Validation result — pure; callers translate to ApiError. */
export type ReadingValidation =
  | { ok: true }
  | { ok: false; code: "INVALID_KM"; message: string }
  | { ok: false; code: "DECREASE_REJECTED"; message: string }
  | { ok: false; code: "HISTORICAL_ABOVE_PROJECTION"; message: string };

export function isLiveSource(source: OdometerSource): boolean {
  return (LIVE_SOURCES as readonly string[]).includes(source);
}

/**
 * Validate a new reading against the vehicle's current projection.
 *
 *  - km must be a non-negative whole number (bounded sanity limit).
 *  - Live sources may not go below the current accepted projection.
 *  - Historical imports never lower the projection; a historical value above
 *    the projection is accepted (the projection is raised) but noted, since it
 *    implies the projection was stale.
 */
export function validateReading(
  km: unknown,
  source: OdometerSource,
  currentProjectionKm: number,
): ReadingValidation {
  if (typeof km !== "number" || !Number.isSafeInteger(km) || km < 0 || km > 5_000_000) {
    return {
      ok: false,
      code: "INVALID_KM",
      message: "Odometer must be a whole number of kilometres between 0 and 5,000,000",
    };
  }
  if (isLiveSource(source) && km < currentProjectionKm) {
    return {
      ok: false,
      code: "DECREASE_REJECTED",
      message:
        `Odometer cannot decrease: latest accepted reading is ${currentProjectionKm} km, ` +
        `got ${km} km. Use the correction workflow if the original reading was wrong.`,
    };
  }
  return { ok: true };
}

/**
 * Validate a correction replacement. Corrections may be lower than the current
 * projection — that is the point — but must be a valid reading.
 */
export function validateCorrection(km: unknown): ReadingValidation {
  if (typeof km !== "number" || !Number.isSafeInteger(km) || km < 0 || km > 5_000_000) {
    return {
      ok: false,
      code: "INVALID_KM",
      message: "Odometer must be a whole number of kilometres between 0 and 5,000,000",
    };
  }
  return { ok: true };
}

/**
 * Check a historical import against neighbouring accepted readings around its
 * effective time. Returns a conflict note when the value breaks monotonicity
 * between its neighbours (caller supplies readings strictly before/after).
 */
export function detectHistoricalConflict(
  km: number,
  previousAcceptedKm: number | null,
  nextAcceptedKm: number | null,
): string | null {
  if (previousAcceptedKm !== null && km < previousAcceptedKm) {
    return `Historical reading ${km} km is below the previous accepted reading (${previousAcceptedKm} km) at an earlier time`;
  }
  if (nextAcceptedKm !== null && km > nextAcceptedKm) {
    return `Historical reading ${km} km exceeds the next accepted reading (${nextAcceptedKm} km) at a later time`;
  }
  return null;
}

/**
 * Recompute the vehicle projection from the ledger: the maximum km among
 * ACCEPTED readings. Corrections and supersessions always leave a consistent
 * answer because superseded originals no longer count.
 */
export function projectionFromLedger(readings: Pick<OdometerReading, "km" | "status">[]): number {
  return readings.filter((r) => r.status === "ACCEPTED").reduce((max, r) => Math.max(max, r.km), 0);
}

/** Difference from the previous accepted reading, when one exists. */
export function deltaFromPrevious(
  km: number,
  previousAcceptedKm: number | null,
): number | undefined {
  if (previousAcceptedKm === null || previousAcceptedKm === undefined) return undefined;
  return km - previousAcceptedKm;
}
