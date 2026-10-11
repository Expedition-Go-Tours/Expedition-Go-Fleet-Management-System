import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS, rolesHavePermission } from "@/lib/auth/permissions";
import { TRIP_PURPOSES, generateStopId } from "@/lib/domain/trip";
import type { TripStop } from "@/lib/domain/trip";
import { TripError, getTripById, updateTrip } from "@/lib/repos/trips";

export const runtime = "nodejs";

/**
 * GET /api/v1/trips/[id]
 * Read a single trip. Requires trip:read.
 * Without trip:read:all, only the trip's driver can view it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.TRIP_READ);

    const { id } = await params;
    const trip = await getTripById(id);
    if (!trip) throw ApiError.notFound("Trip not found");

    // Scope check: non-privileged users can only see their own trips.
    const canReadAll = rolesHavePermission(context.user.roles, PERMISSIONS.TRIP_READ_ALL);
    if (!canReadAll && trip.driverUserId !== context.user.id) {
      throw ApiError.forbidden("You can only view your own trips");
    }

    return jsonOk({ trip });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * PATCH /api/v1/trips/[id]
 * Update a draft trip. Requires trip:update. Only DRAFT trips can be edited.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.TRIP_UPDATE);

    const { id } = await params;
    const existing = await getTripById(id);
    if (!existing) throw ApiError.notFound("Trip not found");

    if (existing.status !== "DRAFT") {
      throw ApiError.badRequest(
        `Cannot edit a trip with status ${existing.status}; only DRAFT trips can be edited`,
      );
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const fields: Parameters<typeof updateTrip>[1] = {};

    if (body.tripDate !== undefined) {
      const val = typeof body.tripDate === "string" ? body.tripDate.trim() : "";
      if (!val || !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
        throw ApiError.badRequest("tripDate must be YYYY-MM-DD format");
      }
      fields.tripDate = val;
    }

    if (body.purpose !== undefined) {
      const val = typeof body.purpose === "string" ? body.purpose.trim() : "";
      if (!(TRIP_PURPOSES as readonly string[]).includes(val)) {
        throw ApiError.badRequest(`purpose must be one of: ${TRIP_PURPOSES.join(", ")}`);
      }
      fields.purpose = val as import("@/lib/domain/trip").TripPurpose;
    }

    if (body.externalReference !== undefined) {
      fields.externalReference =
        typeof body.externalReference === "string"
          ? body.externalReference.trim().slice(0, 200) || undefined
          : undefined;
    }

    if (body.notes !== undefined) {
      fields.notes =
        typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) || undefined : undefined;
    }

    if (body.manualDistanceKm !== undefined) {
      if (body.manualDistanceKm !== null && typeof body.manualDistanceKm !== "number") {
        throw ApiError.badRequest("manualDistanceKm must be a number or null");
      }
      fields.manualDistanceKm = body.manualDistanceKm as number | undefined;
    }

    if (body.manualDistanceReason !== undefined) {
      fields.manualDistanceReason =
        typeof body.manualDistanceReason === "string"
          ? body.manualDistanceReason.trim().slice(0, 500) || undefined
          : undefined;
    }

    if (body.startOdometerKm !== undefined) {
      if (body.startOdometerKm !== null && typeof body.startOdometerKm !== "number") {
        throw ApiError.badRequest("startOdometerKm must be a number or null");
      }
      fields.startOdometerKm = body.startOdometerKm as number | undefined;
    }

    if (body.endOdometerKm !== undefined) {
      if (body.endOdometerKm !== null && typeof body.endOdometerKm !== "number") {
        throw ApiError.badRequest("endOdometerKm must be a number or null");
      }
      fields.endOdometerKm = body.endOdometerKm as number | undefined;
    }

    if (body.stops !== undefined) {
      if (!Array.isArray(body.stops) || body.stops.length < 2) {
        throw ApiError.badRequest("At least 2 stops are required (origin and destination)");
      }
      fields.stops = body.stops.map((s: Record<string, unknown>, index: number): TripStop => ({
        id: typeof s.id === "string" ? s.id : generateStopId(),
        sequence: typeof s.sequence === "number" ? s.sequence : index,
        type:
          s.type === "ORIGIN" || s.type === "DESTINATION" || s.type === "INTERMEDIATE"
            ? (s.type as TripStop["type"])
            : index === 0
              ? "ORIGIN"
              : index === (body.stops as unknown[]).length - 1
                ? "DESTINATION"
                : "INTERMEDIATE",
        label: typeof s.label === "string" ? s.label.trim() : `Stop ${index + 1}`,
        address: typeof s.address === "string" ? s.address : null,
        latitude: typeof s.latitude === "number" ? s.latitude : null,
        longitude: typeof s.longitude === "number" ? s.longitude : null,
        placeId: typeof s.placeId === "string" ? s.placeId : null,
        purpose: typeof s.purpose === "string" ? s.purpose : null,
        notes: typeof s.notes === "string" ? s.notes : null,
        arrivedAt: typeof s.arrivedAt === "string" ? s.arrivedAt : null,
        departedAt: typeof s.departedAt === "string" ? s.departedAt : null,
      }));
    }

    if (Object.keys(fields).length === 0) {
      throw ApiError.badRequest("No updatable fields provided");
    }

    const trip = await updateTrip(id, fields, context.user.id);

    return jsonOk({ trip });
  } catch (error) {
    if (error instanceof TripError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "VALIDATION_FAILED"
            ? 400
            : error.code === "INVALID_STATUS"
              ? 409
              : 400;
      return jsonOk({ error: { code: error.code, message: error.message } }, { status });
    }
    return toErrorResponse(error);
  }
}
