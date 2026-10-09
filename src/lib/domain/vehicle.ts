import { PERMISSIONS } from "@/lib/auth/permissions";
import type { ActionMap } from "@/lib/domain/lifecycle";

/* Vehicle domain model + status lifecycle. */

export const VEHICLE_STATUSES = ["ACTIVE", "IN_SERVICE", "SAFETY_HOLD", "ARCHIVED"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const VEHICLE_TYPES = ["BUS", "VAN", "SUV", "TRUCK", "CAR", "OTHER"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export interface Vehicle {
  id: string;
  /** Registration number (licence plate), unique across the fleet. */
  regNumber: string;
  make: string;
  model: string;
  year: number;
  type: VehicleType;
  vin?: string;
  /** Current odometer reading in km. Never decreases. */
  mileage: number;
  status: VehicleStatus;
  safetyHoldReason?: string;
  archivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  /** User id of the creator. */
  createdBy: string;
}

/**
 * Vehicle status transitions (explicit action endpoints only).
 *
 *  - `release` moves a vehicle out of SAFETY_HOLD and requires the dedicated
 *    `vehicle:release` permission — no role has it by default (§6.4); it must be
 *    granted per user. This is the safety-hold invariant: maintenance can place
 *    a hold but cannot lift one.
 *  - `archive` requires `vehicle:archive` and is additionally blocked in the
 *    route while open work orders exist for the vehicle.
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
