import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { VEHICLE_TYPES } from "@/lib/domain/vehicle";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { createVehicle, getVehicleByRegNumber, listVehicles } from "@/lib/repos/vehicles";

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
 * Register a vehicle. Requires vehicle:create (ADMIN baseline).
 * The registration number is normalised and must be unique.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.VEHICLE_CREATE);

    const body: unknown = await request.json().catch(() => null);
    const { regNumber, make, model, year, type, vin, mileage } = body as Record<string, unknown>;

    const plate = typeof regNumber === "string" ? regNumber.trim().toUpperCase() : "";
    if (!plate || plate.length > 20) {
      throw ApiError.badRequest("Registration number is required (max 20 chars)");
    }
    const vehicleMake = typeof make === "string" ? make.trim() : "";
    const vehicleModel = typeof model === "string" ? model.trim() : "";
    if (!vehicleMake || vehicleMake.length > 100) {
      throw ApiError.badRequest("Make is required (max 100 chars)");
    }
    if (!vehicleModel || vehicleModel.length > 100) {
      throw ApiError.badRequest("Model is required (max 100 chars)");
    }
    const numericYear = Number(year);
    const currentYear = new Date().getFullYear();
    if (!Number.isInteger(numericYear) || numericYear < 1980 || numericYear > currentYear + 1) {
      throw ApiError.badRequest(`Year must be between 1980 and ${currentYear + 1}`);
    }
    if (typeof type !== "string" || !(VEHICLE_TYPES as readonly string[]).includes(type)) {
      throw ApiError.badRequest(`Type must be one of: ${VEHICLE_TYPES.join(", ")}`);
    }
    const parsedMileage = mileage === undefined ? 0 : Number(mileage);
    if (!Number.isSafeInteger(parsedMileage) || parsedMileage < 0) {
      throw ApiError.badRequest("Mileage must be a non-negative integer (km)");
    }
    const parsedVin = typeof vin === "string" && vin.trim().length > 0 ? vin.trim() : undefined;

    const existing = await getVehicleByRegNumber(plate);
    if (existing) {
      throw ApiError.conflict(`A vehicle with registration "${plate}" already exists`);
    }

    const vehicle = await createVehicle({
      regNumber: plate,
      make: vehicleMake,
      model: vehicleModel,
      year: numericYear,
      type: (typeof type === "string"
        ? type
        : "OTHER") as import("@/lib/domain/vehicle").VehicleType,
      vin: parsedVin,
      mileage: parsedMileage,
      createdBy: context.user.id,
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.VEHICLE_CREATED,
      actorId: context.user.id,
      entityType: "vehicle",
      entityId: vehicle.id,
      after: { regNumber: vehicle.regNumber, make: vehicle.make, model: vehicle.model },
      requestId,
    });

    return jsonOk({ vehicle }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
