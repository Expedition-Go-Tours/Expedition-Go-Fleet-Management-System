import { makeActionHandler } from "@/lib/api/action";
import { ApiError } from "@/lib/api/errors";
import { VEHICLE_STATUS_ACTIONS, type Vehicle, type VehicleStatus } from "@/lib/domain/vehicle";
import { AUDIT_EVENTS } from "@/lib/repos/audit";
import { applyVehicleStatus, getVehicleById } from "@/lib/repos/vehicles";
import { countOpenWorkOrders } from "@/lib/repos/work-orders";

export const runtime = "nodejs";

/**
 * POST /api/v1/vehicles/[id]/status
 * Vehicle lifecycle actions:
 *   send_to_workshop | return_to_service | safety_hold | release | archive
 *
 * Permission comes from the action map — notably `release` requires the
 * dedicated vehicle:release grant (no role has it by default), and `archive`
 * requires vehicle:archive and is blocked while open work orders exist.
 */
export const POST = makeActionHandler<VehicleStatus, Vehicle>({
  actions: VEHICLE_STATUS_ACTIONS,
  auditEventType: AUDIT_EVENTS.VEHICLE_STATUS_CHANGED,
  entityType: "vehicle",
  jsonKey: "vehicle",
  load: getVehicleById,
  apply: async (entity, def, body) => {
    const reason =
      typeof body.reason === "string" && body.reason.trim().length > 0
        ? body.reason.trim().slice(0, 500)
        : undefined;
    return applyVehicleStatus(entity.id, def.to, { safetyHoldReason: reason });
  },
  assertAllowed: async (entity, def) => {
    if (def.to === "ARCHIVED") {
      const open = await countOpenWorkOrders(entity.id);
      if (open > 0) {
        throw ApiError.conflict(
          `Cannot archive: ${open} work order(s) are still open for this vehicle. Close them first.`,
        );
      }
    }
  },
});
