import {
  ONBOARDING_SCHEMA_VERSION,
  TOUR_IDS,
  TOUR_STATUSES,
  type OnboardingState,
  type TourId,
  type TourStatus,
} from "@/lib/onboarding/types";
import { getTour } from "@/lib/onboarding/tours";

/*
 * Pure onboarding-state helpers.
 *
 * Deliberately free of `next/server` so the same rules run in unit tests, in
 * the API route (authoritative validation) and in the browser (optimistic UI).
 * Every mutation still goes through the server, which re-validates the payload
 * against the canonical tour version before writing.
 */

export const MAX_TOUR_VERSION = 999;

export function emptyOnboardingState(userId: string): OnboardingState {
  return { userId, schemaVersion: ONBOARDING_SCHEMA_VERSION, tours: {} };
}

function toIso(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const date = (value as { toDate: () => Date }).toDate();
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return undefined;
}

/**
 * Rebuild state from a Firestore document (or any untrusted shape). Unknown
 * statuses, non-integer versions and unknown tour ids are dropped rather than
 * trusted, so a malformed document can never crash the shell.
 */
export function readOnboardingState(userId: string, raw: unknown): OnboardingState {
  const state = emptyOnboardingState(userId);
  if (typeof raw !== "object" || raw === null) return state;

  const tours = (raw as { tours?: unknown }).tours;
  if (typeof tours !== "object" || tours === null) return state;

  for (const tourId of TOUR_IDS) {
    const entry = (tours as Record<string, unknown>)[tourId];
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as { status?: unknown; version?: unknown; updatedAt?: unknown };
    const status = record.status;
    const version = record.version;
    const updatedAt = toIso(record.updatedAt);
    if (!(TOUR_STATUSES as readonly string[]).includes(String(status))) continue;
    if (!Number.isInteger(version) || (version as number) < 1) continue;
    if (!updatedAt) continue;
    state.tours[tourId] = {
      status: status as TourStatus,
      version: version as number,
      updatedAt,
    };
  }

  return state;
}

/** A client-visible payload: exactly `OnboardingState`, ready for RSC → client. */
export function serializeOnboardingState(state: OnboardingState): OnboardingState {
  return {
    userId: state.userId,
    schemaVersion: state.schemaVersion,
    tours: { ...state.tours },
  };
}

export interface OnboardingUpdate {
  kind: "tour";
  tourId: TourId;
  status: TourStatus;
  /** Must equal the server's current version for that tour. */
  version: number;
}

export type ParseResult = { ok: true; value: OnboardingUpdate } | { ok: false; error: string };

/**
 * Validate a POST /api/v1/onboarding body against the canonical catalogue.
 * The version is checked against the server's own tour definition so a stale
 * or hand-rolled client cannot write progress for a version that does not exist.
 */
export function parseOnboardingUpdate(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Request body must be an object" };
  }
  const record = body as Record<string, unknown>;

  const tourId = record.tourId;
  if (typeof tourId !== "string" || !TOUR_IDS.includes(tourId as TourId)) {
    return { ok: false, error: "tourId must be one of: " + TOUR_IDS.join(", ") };
  }
  const definition = getTour(tourId);
  if (!definition) return { ok: false, error: "Unknown tour" };

  const status = record.status;
  if (typeof status !== "string" || !TOUR_STATUSES.includes(status as TourStatus)) {
    return { ok: false, error: "status must be one of: " + TOUR_STATUSES.join(", ") };
  }

  const version = record.version;
  if (!Number.isInteger(version) || (version as number) < 1) {
    return { ok: false, error: "version must be a positive integer" };
  }
  if ((version as number) > MAX_TOUR_VERSION) {
    return { ok: false, error: `version must be at most ${MAX_TOUR_VERSION}` };
  }
  if ((version as number) !== definition.version) {
    return {
      ok: false,
      error: `version mismatch: this server publishes ${definition.id} v${definition.version}`,
    };
  }

  return {
    ok: true,
    value: {
      kind: "tour",
      tourId: tourId as TourId,
      status: status as TourStatus,
      version: version as number,
    },
  };
}

/** Immutably apply a validated update to a state object. */
export function applyOnboardingUpdate(
  state: OnboardingState,
  update: OnboardingUpdate,
  now: Date = new Date(),
): OnboardingState {
  return {
    ...state,
    schemaVersion: ONBOARDING_SCHEMA_VERSION,
    tours: {
      ...state.tours,
      [update.tourId]: {
        status: update.status,
        version: update.version,
        updatedAt: now.toISOString(),
      },
    },
  };
}
