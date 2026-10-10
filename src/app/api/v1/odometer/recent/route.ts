import { jsonOk, toErrorResponse } from "@/lib/api/errors";
import { requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listVehicles } from "@/lib/repos/vehicles";
import { listReadings } from "@/lib/repos/odometers";

export const runtime = "nodejs";

/**
 * GET /api/v1/odometer/recent
 * The latest accepted readings across the fleet (odometer:read) — dashboard feed.
 */
export async function GET() {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.ODOMETER_READ);

    const vehicles = await listVehicles({ limit: 25 });
    const recent: { vehicleId: string; regNumber: string; readings: unknown[] }[] = [];
    for (const vehicle of vehicles) {
      const readings = await listReadings(vehicle.id, { limit: 3 });
      recent.push({ vehicleId: vehicle.id, regNumber: vehicle.regNumber, readings });
    }
    return jsonOk({ recent });
  } catch (error) {
    return toErrorResponse(error);
  }
}
