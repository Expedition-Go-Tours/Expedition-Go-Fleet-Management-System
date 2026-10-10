import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { FUEL_TYPES, VEHICLE_TYPES } from "@/lib/domain/vehicle";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { createVehicle, getVehicleByRegNumber, listVehicles } from "@/lib/repos/vehicles";
import { recordReading } from "@/lib/repos/odometers";

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

    const vehicle = await createVehicle({
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
    });

    // Record the initial odometer through the ledger when a baseline is given.
    if (odometerKm > 0) {
      await recordReading({
        vehicleId: vehicle.id,
        km: odometerKm,
        source: "MANUAL_ENTRY",
        recordedByUserId: context.user.id,
        notes: "Initial odometer baseline at vehicle registration",
        clientToken: `setup-${vehicle.id}`,
        allowDecrease: true,
      });
    }

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.VEHICLE_CREATED,
      actorId: context.user.id,
      entityType: "vehicle",
      entityId: vehicle.id,
      after: {
        regNumber: vehicle.regNumber,
        make: vehicle.make,
        model: vehicle.model,
        odometerKm,
      },
      requestId,
    });

    return jsonOk({ vehicle }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
