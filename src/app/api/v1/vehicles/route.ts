import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { FUEL_TYPES, VEHICLE_TYPES } from "@/lib/domain/vehicle";
import {
  createVehicleAtomic,
  getVehicleByRegNumber,
  listVehicles,
  VehicleCreationError,
} from "@/lib/repos/vehicles";

export const runtime = "nodejs";

/**
 * GET /api/v1/vehicles
 * List vehicles (newest first, archived excluded by default).
 * Query: ?includeArchived=true (still requires vehicle:read).
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.VEHICLE_READ);

    const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "true";
    const vehicles = await listVehicles({ includeArchived });
    return jsonOk({ vehicles });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/vehicles
 * Register a company vehicle. Requires vehicle:create (ADMIN baseline).
 * An initial odometer baseline is recorded through the ledger — the reading
 * is audited as an explicit setup entry, never a silent field write.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.VEHICLE_CREATE);

    const body: unknown = await request.json().catch(() => null);
    const b = (body ?? {}) as Record<string, unknown>;

    const plate = typeof b.regNumber === "string" ? b.regNumber.trim().toUpperCase() : "";
    if (!plate || plate.length > 20) {
      throw ApiError.badRequest("Registration number is required (max 20 chars)");
    }
    const make = typeof b.make === "string" ? b.make.trim() : "";
    const model = typeof b.model === "string" ? b.model.trim() : "";
    if (!make || make.length > 100) throw ApiError.badRequest("Make is required (max 100 chars)");
    if (!model || model.length > 100)
      throw ApiError.badRequest("Model is required (max 100 chars)");
    const numericYear = Number(b.year);
    const currentYear = new Date().getFullYear();
    if (!Number.isInteger(numericYear) || numericYear < 1980 || numericYear > currentYear + 1) {
      throw ApiError.badRequest(`Year must be between 1980 and ${currentYear + 1}`);
    }
    if (typeof b.type !== "string" || !(VEHICLE_TYPES as readonly string[]).includes(b.type)) {
      throw ApiError.badRequest(`Type must be one of: ${VEHICLE_TYPES.join(", ")}`);
    }
    if (
      b.fuelType !== undefined &&
      !(FUEL_TYPES as readonly string[]).includes(b.fuelType as string)
    ) {
      throw ApiError.badRequest(`Fuel type must be one of: ${FUEL_TYPES.join(", ")}`);
    }
    const odometerKm = b.odometerKm === undefined ? 0 : Number(b.odometerKm);
    if (!Number.isSafeInteger(odometerKm) || odometerKm < 0) {
      throw ApiError.badRequest("Initial odometer must be a non-negative integer (km)");
    }
    const seatingCapacity =
      b.seatingCapacity === undefined || b.seatingCapacity === null
        ? undefined
        : Number(b.seatingCapacity);
    if (
      seatingCapacity !== undefined &&
      (!Number.isInteger(seatingCapacity) || seatingCapacity < 1)
    ) {
      throw ApiError.badRequest("Seating capacity must be a positive integer");
    }

    const existing = await getVehicleByRegNumber(plate);
    if (existing) {
      throw ApiError.conflict(`A vehicle with registration "${plate}" already exists`);
    }

    // Vehicle + initial odometer ledger entry + projection + audit event commit
    // in one transaction; the registration lock makes duplicate plates
    // impossible even under concurrent requests.
    const vehicle = await createVehicleAtomic({
      regNumber: plate,
      make,
      model,
      year: numericYear,
      type: b.type as import("@/lib/domain/vehicle").VehicleType,
      vin: typeof b.vin === "string" && b.vin.trim() ? b.vin.trim() : undefined,
      seatingCapacity,
      fuelType: b.fuelType as import("@/lib/domain/vehicle").FuelType | undefined,
      acquiredOn: typeof b.acquiredOn === "string" ? b.acquiredOn : undefined,
      inServiceOn: typeof b.inServiceOn === "string" ? b.inServiceOn : undefined,
      odometerKm,
      createdBy: context.user.id,
      requestId,
    }).catch((error: unknown) => {
      if (error instanceof VehicleCreationError) throw ApiError.conflict(error.message);
      throw error;
    });

    return jsonOk({ vehicle }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
