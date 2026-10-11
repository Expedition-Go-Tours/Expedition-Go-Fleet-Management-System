import { NextRequest, NextResponse } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS, rolesHavePermission } from "@/lib/auth/permissions";
import type { RouteLeg } from "@/lib/domain/trip";
import { getRoutingProvider, RoutingError } from "@/lib/routing/index";
import type { RouteWaypoint } from "@/lib/routing/provider";
import { getTripById, saveRouteCalculation } from "@/lib/repos/trips";

export const runtime = "nodejs";

const MAX_WAYPOINTS = 25; // Mapbox limit

/**
 * POST /api/v1/trips/calculate-route
 * Calculate route distance for a set of waypoints or an existing trip's stops.
 * Requires trip:create.
 *
 * Body: { waypoints: Array<{ latitude, longitude, label? }> }
 *    OR  { tripId: string }
 */
export async function POST(request: NextRequest) {
  // requestId available if needed for audit
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.TRIP_CREATE);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    let waypoints: RouteWaypoint[];
    let tripId: string | undefined;
    let stopIds: string[] | undefined;

    if (typeof body.tripId === "string" && body.tripId.trim()) {
      // Use existing trip's stops as waypoints
      tripId = body.tripId.trim();
      const trip = await getTripById(tripId);
      if (!trip) throw ApiError.notFound("Trip not found");

      // Authorization: drivers can only update their own drafts
      const canReadAll = rolesHavePermission(context.user.roles, PERMISSIONS.TRIP_READ_ALL);
      if (!canReadAll && trip.driverUserId !== context.user.id) {
        throw ApiError.forbidden("You can only calculate routes for your own trips");
      }
      if (trip.status !== "DRAFT") {
        throw ApiError.badRequest(`Cannot calculate route for a ${trip.status} trip`);
      }

      waypoints = trip.stops
        .filter((s) => s.latitude !== null && s.longitude !== null)
        .sort((a, b) => a.sequence - b.sequence)
        .map((s) => ({
          latitude: s.latitude!,
          longitude: s.longitude!,
          label: s.label,
        }));

      stopIds = trip.stops
        .filter((s) => s.latitude !== null && s.longitude !== null)
        .sort((a, b) => a.sequence - b.sequence)
        .map((s) => s.id);

      if (waypoints.length < 2) {
        throw ApiError.badRequest(
          "Trip does not have enough stops with coordinates (need at least 2)",
        );
      }
    } else if (Array.isArray(body.waypoints)) {
      // Use provided waypoints
      const raw = body.waypoints as unknown[];
      if (raw.length < 2) {
        throw ApiError.badRequest("At least 2 waypoints are required");
      }
      if (raw.length > MAX_WAYPOINTS) {
        throw ApiError.badRequest(`Maximum ${MAX_WAYPOINTS} waypoints allowed`);
      }

      waypoints = raw.map((w: unknown, index: number) => {
        const wp = w as Record<string, unknown>;
        if (typeof wp.latitude !== "number" || typeof wp.longitude !== "number") {
          throw ApiError.badRequest(
            `Waypoint ${index}: latitude and longitude are required numbers`,
          );
        }
        if (wp.latitude < -90 || wp.latitude > 90) {
          throw ApiError.badRequest(`Waypoint ${index}: latitude must be between -90 and 90`);
        }
        if (wp.longitude < -180 || wp.longitude > 180) {
          throw ApiError.badRequest(`Waypoint ${index}: longitude must be between -180 and 180`);
        }
        return {
          latitude: wp.latitude,
          longitude: wp.longitude,
          label: typeof wp.label === "string" ? wp.label : undefined,
        };
      });
    } else {
      throw ApiError.badRequest("Provide either waypoints array or tripId");
    }

    // Calculate route with timeout
    const provider = getRoutingProvider();
    let route: Awaited<ReturnType<typeof provider.calculateRoute>>;
    try {
      route = await Promise.race([
        provider.calculateRoute(waypoints),
        new Promise<never>((_, reject) => setTimeout(() => reject(RoutingError.timeout()), 30_000)),
      ]);
    } catch (err) {
      if (err instanceof RoutingError) {
        const status =
          err.code === "INVALID_WAYPOINTS"
            ? 400
            : err.code === "NO_ROUTE"
              ? 400
              : err.code === "TIMEOUT"
                ? 504
                : err.code === "RATE_LIMITED"
                  ? 429
                  : err.code === "NOT_CONFIGURED"
                    ? 503
                    : 502;
        return NextResponse.json({ error: { code: err.code, message: err.message } }, { status });
      }
      throw err;
    }

    // Build RouteLeg[] from the result
    const legs: RouteLeg[] = route.legs.map((leg, index) => ({
      fromStopId: stopIds?.[index] ?? `wp_${index}`,
      toStopId: stopIds?.[index + 1] ?? `wp_${index + 1}`,
      sequence: index,
      distanceM: leg.distanceM,
      durationS: leg.durationS,
    }));

    // Persist on the trip if tripId was provided
    if (tripId) {
      // Re-check trip is still editable and stops haven't changed
      const currentTrip = await getTripById(tripId);
      if (!currentTrip || currentTrip.status !== "DRAFT") {
        throw ApiError.badRequest("Trip is no longer editable");
      }
      // Verify stop order hasn't changed during calculation
      const currentFingerprint = currentTrip.stops.map((s) => s.id).join(",");
      const requestedFingerprint = stopIds?.join(",");
      if (currentFingerprint !== requestedFingerprint) {
        throw ApiError.badRequest("Stops changed during route calculation — please recalculate");
      }
      await saveRouteCalculation(tripId, route, legs);
    }

    return jsonOk({ route, legs });
  } catch (error) {
    return toErrorResponse(error);
  }
}
