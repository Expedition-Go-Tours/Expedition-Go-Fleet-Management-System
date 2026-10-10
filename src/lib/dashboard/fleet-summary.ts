/*
 * Pure fleet-availability logic (no Firestore, no I/O).
 *
 * The dashboard KPI ("Available now", "In use") and the vehicles list
 * drill-down MUST agree: both call these helpers with the same inputs, so a
 * metric can never link to a set that does not match the number shown.
 *
 * "Available" is stricter than "status is ACTIVE": a vehicle that is assigned,
 * in the workshop, on a safety hold, or carrying an open critical issue is not
 * available to be dispatched, even though its base status is ACTIVE.
 */

export interface FleetSummary {
  total: number;
  available: number;
  inUse: number;
  inWorkshop: number;
  safetyHolds: number;
}

export interface VehicleStatusLike {
  id: string;
  status: string;
}

export const OPEN_ISSUE_STATUSES = ["OPEN", "TRIAGED"] as const;
export const OPEN_WORK_ORDER_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING"] as const;
export const WORK_ORDER_OPEN_STATUS_SET: ReadonlySet<string> = new Set(OPEN_WORK_ORDER_STATUSES);

/** Compute the fleet KPI totals from already-loaded projections. */
export function summariseFleet(
  vehicles: readonly VehicleStatusLike[],
  activeAssignmentVehicleIds: ReadonlySet<string>,
  criticalIssueVehicleIds: ReadonlySet<string>,
): FleetSummary {
  const fleet: FleetSummary = {
    total: vehicles.length,
    available: 0,
    inUse: 0,
    inWorkshop: 0,
    safetyHolds: 0,
  };
  for (const vehicle of vehicles) {
    if (vehicle.status === "SAFETY_HOLD") fleet.safetyHolds += 1;
    if (vehicle.status === "IN_SERVICE") fleet.inWorkshop += 1;
    if (vehicle.status === "ACTIVE" && activeAssignmentVehicleIds.has(vehicle.id)) fleet.inUse += 1;
    if (
      vehicleMatchesAvailability(
        vehicle,
        "available",
        activeAssignmentVehicleIds,
        criticalIssueVehicleIds,
      )
    ) {
      fleet.available += 1;
    }
  }
  return fleet;
}

export type AvailabilityFilter = "available" | "in_use";

export function parseAvailabilityFilter(value: string | undefined): AvailabilityFilter | null {
  return value === "available" || value === "in_use" ? value : null;
}

export function vehicleMatchesAvailability(
  vehicle: VehicleStatusLike,
  filter: AvailabilityFilter,
  activeAssignmentVehicleIds: ReadonlySet<string>,
  criticalIssueVehicleIds: ReadonlySet<string>,
): boolean {
  if (filter === "in_use") {
    return vehicle.status === "ACTIVE" && activeAssignmentVehicleIds.has(vehicle.id);
  }
  return (
    vehicle.status === "ACTIVE" &&
    !activeAssignmentVehicleIds.has(vehicle.id) &&
    !criticalIssueVehicleIds.has(vehicle.id)
  );
}
