import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { VEHICLE_TYPES } from "@/lib/domain/vehicle";
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
 * Update vehicle details (make/model/year/type/vin/mileage).
 * Requires vehicle:update. `status` is NOT updatable here — status changes go
 * through POST /vehicles/[id]/status with an explicit action. The odometer
 * value can never decrease.
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
    if (body.mileage !== undefined) {
      const value = Number(body.mileage);
      if (!Number.isSafeInteger(value) || value < 0) {
        throw ApiError.badRequest("Mileage must be a non-negative integer (km)");
      }
      if (value < vehicle.mileage) {
        throw ApiError.badRequest(
          `Odometer cannot decrease (current: ${vehicle.mileage} km, got: ${value} km)`,
        );
      }
      fields.mileage = value;
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
        mileage: vehicle.mileage,
      },
      after: {
        make: updated.make,
        model: updated.model,
        year: updated.year,
        mileage: updated.mileage,
      },
      requestId,
    });

    return jsonOk({ vehicle: updated });
  } catch (error) {
    return toErrorResponse(error);
  }
}
