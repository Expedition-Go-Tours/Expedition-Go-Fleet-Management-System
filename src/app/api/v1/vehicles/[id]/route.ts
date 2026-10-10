import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { FUEL_TYPES, VEHICLE_TYPES } from "@/lib/domain/vehicle";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { getVehicleById, updateVehicle } from "@/lib/repos/vehicles";

export const runtime = "nodejs";

/**
 * GET /api/v1/vehicles/[id]
 * Read one vehicle. Requires vehicle:read.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.VEHICLE_READ);

    const { id } = await params;
    const vehicle = await getVehicleById(id);
    if (!vehicle) throw ApiError.notFound("Vehicle not found");
    return jsonOk({ vehicle });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * PATCH /api/v1/vehicles/[id]
 * Update vehicle details (make/model/year/type/vin/seating/fuel/dates).
 * Requires vehicle:update.
 *
 * `odometerKm` is NOT editable here — mileage changes go exclusively through
 * the audited odometer-recording workflow (POST /vehicles/[id]/odometer).
 * `status` is NOT editable here — status changes are explicit actions.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.VEHICLE_UPDATE);

    const { id } = await params;
    const vehicle = await getVehicleById(id);
    if (!vehicle) throw ApiError.notFound("Vehicle not found");

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");
    if ("status" in body) {
      throw ApiError.badRequest(
        "Status cannot be changed here — use POST /vehicles/{id}/status with an action",
      );
    }
    if ("odometerKm" in body || "mileage" in body) {
      throw ApiError.badRequest(
        "Odometer cannot be edited directly — use POST /vehicles/{id}/odometer to record a reading",
      );
    }

    const fields: Parameters<typeof updateVehicle>[1] = {};

    if (body.make !== undefined) {
      const value = typeof body.make === "string" ? body.make.trim() : "";
      if (!value || value.length > 100) throw ApiError.badRequest("Invalid make");
      fields.make = value;
    }
    if (body.model !== undefined) {
      const value = typeof body.model === "string" ? body.model.trim() : "";
      if (!value || value.length > 100) throw ApiError.badRequest("Invalid model");
      fields.model = value;
    }
    if (body.year !== undefined) {
      const value = Number(body.year);
      const currentYear = new Date().getFullYear();
      if (!Number.isInteger(value) || value < 1980 || value > currentYear + 1) {
        throw ApiError.badRequest(`Year must be between 1980 and ${currentYear + 1}`);
      }
      fields.year = value;
    }
    if (body.type !== undefined) {
      if (
        typeof body.type !== "string" ||
        !(VEHICLE_TYPES as readonly string[]).includes(body.type)
      ) {
        throw ApiError.badRequest(`Type must be one of: ${VEHICLE_TYPES.join(", ")}`);
      }
      fields.type = body.type as import("@/lib/domain/vehicle").VehicleType;
    }
    if (body.vin !== undefined) {
      const value = typeof body.vin === "string" ? body.vin.trim() : "";
      fields.vin = value.length > 0 ? value : undefined;
    }
    if (body.seatingCapacity !== undefined) {
      const value = Number(body.seatingCapacity);
      if (!Number.isInteger(value) || value < 1) {
        throw ApiError.badRequest("Seating capacity must be a positive integer");
      }
      fields.seatingCapacity = value;
    }
    if (body.fuelType !== undefined) {
      if (
        typeof body.fuelType !== "string" ||
        !(FUEL_TYPES as readonly string[]).includes(body.fuelType)
      ) {
        throw ApiError.badRequest(`Fuel type must be one of: ${FUEL_TYPES.join(", ")}`);
      }
      fields.fuelType = body.fuelType as import("@/lib/domain/vehicle").FuelType;
    }
    if (body.acquiredOn !== undefined) {
      fields.acquiredOn = typeof body.acquiredOn === "string" ? body.acquiredOn : undefined;
    }
    if (body.inServiceOn !== undefined) {
      fields.inServiceOn = typeof body.inServiceOn === "string" ? body.inServiceOn : undefined;
    }

    if (Object.keys(fields).length === 0) {
      throw ApiError.badRequest("No updatable fields provided");
    }

    const updated = await updateVehicle(id, fields);

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.VEHICLE_UPDATED,
      actorId: context.user.id,
      entityType: "vehicle",
      entityId: id,
      before: {
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        seatingCapacity: vehicle.seatingCapacity ?? null,
        fuelType: vehicle.fuelType ?? null,
      },
      after: {
        make: updated.make,
        model: updated.model,
        year: updated.year,
        seatingCapacity: updated.seatingCapacity ?? null,
        fuelType: updated.fuelType ?? null,
      },
      requestId,
    });

    return jsonOk({ vehicle: updated });
  } catch (error) {
    return toErrorResponse(error);
  }
}
