import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS, rolesHavePermission } from "@/lib/auth/permissions";
import { getTripDistanceMetres } from "@/lib/domain/trip";
import { listTripsForDriverDate } from "@/lib/repos/trips";

export const runtime = "nodejs";

/**
 * GET /api/v1/trips/daily
 * Get trips for a specific date (driver's daily view). Requires trip:read.
 * Without trip:read:all, results are scoped to the authenticated user.
 * Query: ?date=YYYY-MM-DD&driverUserId=
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.TRIP_READ);

    const params = request.nextUrl.searchParams;
    const date = params.get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw ApiError.badRequest("date query param is required in YYYY-MM-DD format");
    }

    // Determine which driver to query for.
    const canReadAll = rolesHavePermission(context.user.roles, PERMISSIONS.TRIP_READ_ALL);
    let driverUserId = params.get("driverUserId") ?? undefined;
    if (!canReadAll) {
      driverUserId = context.user.id;
    }
    if (!driverUserId) {
      driverUserId = context.user.id;
    }

    const trips = await listTripsForDriverDate(driverUserId, date);

    // Compute summary using the same distance precedence as the vehicle
    // projection: actual odometer > authorized manual > route estimate.
    let totalDistanceM = 0;
    for (const trip of trips) {
      const metres = getTripDistanceMetres(trip);
      if (metres !== null) totalDistanceM += metres;
    }

    return jsonOk({
      trips,
      date,
      summary: {
        totalTrips: trips.length,
        totalDistanceM,
        totalDistanceKm: Math.round((totalDistanceM / 1000) * 100) / 100,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
