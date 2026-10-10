import { PERMISSIONS } from "@/lib/auth/permissions";
import type { ActionMap } from "@/lib/domain/lifecycle";

/*
 * Vehicle assignment / trip log.
 *
 * The record of which employee operated which vehicle, when and why. Trip
 * distance is ALWAYS end odometer − start odometer from accepted readings —
 * never a route estimate. Missing end readings mean the distance is
 * incomplete, not zero.
 */

export const ASSIGNMENT_STATUSES = ["ACTIVE", "COMPLETED", "CANCELLED"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const ASSIGNMENT_PURPOSES = [
  "TOUR",
  "TRANSFER",
  "AIRPORT_PICKUP",
  "STAFF_OPERATION",
  "MAINTENANCE",
  "OTHER",
] as const;
export type AssignmentPurpose = (typeof ASSIGNMENT_PURPOSES)[number];

export interface VehicleAssignment {
  id: string;
  vehicleId: string;
  driverUserId: string;
  purpose: AssignmentPurpose;
  /** Free-text tour/transfer/booking reference from the existing workflow. */
  externalReference?: string;
  notes?: string;
  status: AssignmentStatus;
  startedAt?: Date;
  startOdometerKm?: number;
  startOdometerReadingId?: string;
  endedAt?: Date;
  endOdometerKm?: number;
  endOdometerReadingId?: string;
  /** end − start when both readings exist; undefined = incomplete. */
  distanceKm?: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export const ASSIGNMENT_ACTIONS = {
  complete: {
    permission: PERMISSIONS.ASSIGNMENT_END,
    from: ["ACTIVE"],
    to: "COMPLETED",
  },
  cancel: {
    permission: PERMISSIONS.ASSIGNMENT_CANCEL,
    from: ["ACTIVE"],
    to: "CANCELLED",
  },
} as const satisfies ActionMap<AssignmentStatus>;

/**
 * Trip distance from accepted readings. Returns null (incomplete) rather
 * than fabricating a number when either reading is missing or contradictory.
 */
export function computeTripDistance(
  startKm: number | null | undefined,
  endKm: number | null | undefined,
): { distanceKm: number | null; complete: boolean; conflict: boolean } {
  if (typeof startKm !== "number" || typeof endKm !== "number") {
    return { distanceKm: null, complete: false, conflict: false };
  }
  if (endKm < startKm) {
    return { distanceKm: null, complete: false, conflict: true };
  }
  return { distanceKm: endKm - startKm, complete: true, conflict: false };
}
