import type { PermissionKey } from "@/lib/auth/permissions";
import type { RoleKey } from "@/lib/auth/types";

/*
 * Guided onboarding domain model.
 *
 * Shared by the server (repo + API) and the browser (tour controller), so it
 * must stay free of `server-only`/`client-only` imports and of any reference to
 * `next/server` — client components import this file directly.
 */

/** Every tour that exists in the product. Keep in sync with `TOURS`. */
export const TOUR_IDS = ["driver", "operations", "maintenance", "finance", "admin"] as const;
export type TourId = (typeof TOUR_IDS)[number];

/** `COMPLETED` = the tour was watched to the end. `DISMISSED` = postponed/skipped. */
export const TOUR_STATUSES = ["COMPLETED", "DISMISSED"] as const;
export type TourStatus = (typeof TOUR_STATUSES)[number];

/** Bumped when a user record predates the current onboarding schema. */
export const ONBOARDING_SCHEMA_VERSION = 1;

export interface TourProgress {
  status: TourStatus;
  /** The `TourDefinition.version` this result belongs to. */
  version: number;
  updatedAt: string;
}

/**
 * Per-employee onboarding state. One Firestore document per authenticated user,
 * so it follows them across devices and can never be edited by anyone else.
 */
export interface OnboardingState {
  userId: string;
  schemaVersion: number;
  tours: Partial<Record<TourId, TourProgress>>;
}

export type TourSide = "top" | "bottom" | "left" | "right";
export type TourAlign = "start" | "center" | "end";

/**
 * Why a tour ended. `completed` = watched to the end, `dismissed` = skipped or
 * closed early, `stalled` = the next route never became usable (exit cleanly
 * rather than leaving the user stuck mid-tour).
 */
export type TourEndReason = "completed" | "dismissed" | "stalled";

export interface TourStep {
  /**
   * Stable `data-tour` hook on the real control, e.g. `dashboard-overview`.
   * Never a CSS class or a layout-dependent selector.
   */
  target: string;
  /**
   * Alternate hooks tried in order after `target`, for responsive or
   * conditionally-rendered UI (e.g. sidebar link on desktop, menu button on
   * mobile). When none resolve the step is skipped — the tour must never hang.
   */
  fallbacks?: string[];
  /** Absolute route the step has to run on; the controller navigates first. */
  route: string;
  title: string;
  /** One or two short sentences. Explain what it does and why it matters. */
  description: string;
  side?: TourSide;
  align?: TourAlign;
  /** Skip this step unless the user holds at least one of these permissions. */
  requires?: PermissionKey[];
}

export interface TourDefinition {
  id: TourId;
  /** Bump to re-offer a materially redesigned tour to everyone. */
  version: number;
  title: string;
  summary: string;
  /** Roles that this tour is authored for. */
  roles: RoleKey[];
  /** The tour is only offered when the user holds at least one of these. */
  requiresAnyOf: PermissionKey[];
  /** Route the tour begins on (used when launched from anywhere). */
  startRoute: string;
  steps: TourStep[];
}
