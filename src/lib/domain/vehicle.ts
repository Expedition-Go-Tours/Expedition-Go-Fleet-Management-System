import { PERMISSIONS } from "@/lib/auth/permissions";
import type { ActionMap } from "@/lib/domain/lifecycle";

/* Vehicle domain model + status lifecycle. */

export const VEHICLE_STATUSES = ["ACTIVE", "IN_SERVICE", "SAFETY_HOLD", "ARCHIVED"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const VEHICLE_TYPES = ["BUS", "VAN", "SUV", "TRUCK", "CAR", "OTHER"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const FUEL_TYPES = ["PETROL", "DIESEL", "HYBRID", "ELECTRIC", "OTHER"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

/**
 * Who owns the vehicle. `RENTED` covers a bus hired in for a tour — it behaves
 * exactly like a company vehicle (odometer ledger, fuel, expenses, trips all
 * work the same) but is recorded honestly, so reports can tell the difference
 * and the bus can be archived when the rental ends without losing its history.
 */
export const OWNERSHIP_CLASSES = ["COMPANY_OWNED", "RENTED"] as const;
export type OwnershipClass = (typeof OWNERSHIP_CLASSES)[number];

export interface RentedVehicleInput {
  regNumber: string;
  make: string;
  model: string;
  year: number;
  type: VehicleType;
}

/**
 * Validate the details supplied for a bus that is not on the fleet list yet.
 *
 * Plate, make, model and year are all required. That is deliberate: the odometer
 * ledger, fuel consumption and the expense mirror all hang off a real,
 * identifiable vehicle, and a record carrying a placeholder name is worse than
 * no record at all — it reads as real data in every report it lands in.
 */
export function parseRentedVehicleSpec(
  raw: unknown,
): { ok: true; spec: RentedVehicleInput } | { ok: false; message: string } {
  const body = (raw ?? {}) as Record<string, unknown>;

  const regNumber = typeof body.regNumber === "string" ? body.regNumber.trim() : "";
  if (!regNumber) return { ok: false, message: "Registration number is required" };
  if (regNumber.length > 20)
    return { ok: false, message: "Registration is too long (max 20 chars)" };

  const make = typeof body.make === "string" ? body.make.trim() : "";
  if (!make) return { ok: false, message: "Make is required" };
  if (make.length > 100) return { ok: false, message: "Make is too long (max 100 chars)" };

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) return { ok: false, message: "Model is required" };
  if (model.length > 100) return { ok: false, message: "Model is too long (max 100 chars)" };

  const year = Number(body.year);
  const currentYear = new Date().getFullYear();
  if (!Number.isInteger(year) || year < 1980 || year > currentYear + 1) {
    return { ok: false, message: `Year must be between 1980 and ${currentYear + 1}` };
  }

  const type = typeof body.type === "string" && body.type ? body.type : "BUS";
  if (!(VEHICLE_TYPES as readonly string[]).includes(type)) {
    return { ok: false, message: `Type must be one of: ${VEHICLE_TYPES.join(", ")}` };
  }

  return { ok: true, spec: { regNumber, make, model, year, type: type as VehicleType } };
}

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
 *  - `release` moves a vehicle out of SAFETY_HOLD and requires the dedicated,
 *    ADMIN-only `vehicle:release` permission (§6.4); the route additionally
 *    re-checks open critical issues before releasing.
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

/**
 * Server-side safety invariant for returning a held vehicle to service.
 * Holding `vehicle:release` is necessary but never sufficient: any unresolved
 * critical issue blocks the release. Returns the refusal message, or null when
 * the release may proceed.
 */
export function releaseBlockReason(openCriticalIssues: number): string | null {
  if (!Number.isSafeInteger(openCriticalIssues) || openCriticalIssues < 0) {
    // Fail closed: an unknown count must never read as "nothing outstanding".
    return "Cannot release: the open safety issues could not be checked.";
  }
  return openCriticalIssues > 0
    ? `Cannot release: ${openCriticalIssues} open critical issue(s) must be resolved first.`
    : null;
}
