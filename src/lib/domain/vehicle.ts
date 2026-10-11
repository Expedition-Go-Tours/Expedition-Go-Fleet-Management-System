import { PERMISSIONS } from "@/lib/auth/permissions";
import type { ActionMap } from "@/lib/domain/lifecycle";

/* Vehicle domain model + status lifecycle. */

export const VEHICLE_STATUSES = ["ACTIVE", "IN_SERVICE", "SAFETY_HOLD", "ARCHIVED"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const VEHICLE_TYPES = ["BUS", "VAN", "SUV", "TRUCK", "CAR", "OTHER"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const FUEL_TYPES = ["PETROL", "DIESEL", "HYBRID", "ELECTRIC", "OTHER"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const OWNERSHIP_CLASSES = ["COMPANY_OWNED"] as const;
export type OwnershipClass = (typeof OWNERSHIP_CLASSES)[number];

export interface Vehicle {
  id: string;
  /** Registration number (licence plate), unique across the fleet. */
  regNumber: string;
  make: string;
  model: string;
  year: number;
  type: VehicleType;
  vin?: string;
  seatingCapacity?: number;
  fuelType?: FuelType;
  ownership: OwnershipClass;
  /** Dates may be unknown on day one — never invented. */
  acquiredOn?: string;
  inServiceOn?: string;
  /** Current projection of the accepted odometer ledger. */
  odometerKm: number;
  /** When/where the projection came from. */
  odometerAt?: Date;
  odometerSource?: string;
  status: VehicleStatus;
  safetyHoldReason?: string;
  /** Issue id that caused the current hold, when applicable. */
  safetyHoldIssueId?: string;
  safetyHoldAppliedBy?: string;
  safetyHoldAppliedAt?: Date;
  archivedAt?: Date;
  /** Estimated operational kilometres from completed trips since last verified baseline. */
  estimatedKm?: number;
  /** When estimatedKm was last recomputed. */
  estimatedKmUpdatedAt?: Date;
  /** Number of completed trips contributing to estimatedKm. */
  estimatedKmTripCount?: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

/**
 * Vehicle status transitions (explicit action endpoints only).
 *
 *  - `release` moves a vehicle out of SAFETY_HOLD and requires the dedicated
 *    `vehicle:release` permission — no role has it by default (§6.4); the
 *    route additionally re-checks open critical issues before releasing.
 *  - `archive` requires `vehicle:archive` and is blocked in the route while
 *    open work orders exist.
 */
export const VEHICLE_STATUS_ACTIONS = {
  send_to_workshop: {
    permission: PERMISSIONS.VEHICLE_STATUS_UPDATE,
    from: ["ACTIVE"],
    to: "IN_SERVICE",
  },
  return_to_service: {
    permission: PERMISSIONS.VEHICLE_STATUS_UPDATE,
    from: ["IN_SERVICE"],
    to: "ACTIVE",
  },
  safety_hold: {
    permission: PERMISSIONS.VEHICLE_STATUS_UPDATE,
    from: ["ACTIVE", "IN_SERVICE"],
    to: "SAFETY_HOLD",
  },
  release: {
    permission: PERMISSIONS.VEHICLE_RELEASE,
    from: ["SAFETY_HOLD"],
    to: "ACTIVE",
  },
  archive: {
    permission: PERMISSIONS.VEHICLE_ARCHIVE,
    from: ["ACTIVE", "IN_SERVICE", "SAFETY_HOLD"],
    to: "ARCHIVED",
  },
} as const satisfies ActionMap<VehicleStatus>;
