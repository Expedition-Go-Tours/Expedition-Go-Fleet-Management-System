import { NextRequest, NextResponse } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { TripError, completeTrip, getTripById } from "@/lib/repos/trips";

export const runtime = "nodejs";

/**
 * POST /api/v1/trips/[id]/complete
 * Complete a trip. Requires trip:complete.
 * Idempotent — returns existing result if the trip is already completed.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.TRIP_COMPLETE);

    const routeParams = await params;
    const tripId = routeParams.id;
    const existing = await getTripById(tripId);
    if (!existing) throw ApiError.notFound("Trip not found");

    const parsed = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!parsed) throw ApiError.badRequest("Invalid JSON body");

    const startOdometerKm =
      typeof parsed.startOdometerKm === "number" ? parsed.startOdometerKm : undefined;
    const endOdometerKm =
      typeof parsed.endOdometerKm === "number" ? parsed.endOdometerKm : undefined;
    const notes = typeof parsed.notes === "string" ? parsed.notes.trim().slice(0, 1000) : undefined;

    const result = await completeTrip(tripId, {
      actorId: context.user.id,
      startOdometerKm,
      endOdometerKm,
      notes,
    });

    return jsonOk({ trip: result.trip, projectionUpdated: result.projectionUpdated });
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
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
    }
    return toErrorResponse(error);
  }
}
