import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS, rolesHavePermission } from "@/lib/auth/permissions";
import { TRIP_PURPOSES, TRIP_STATUSES } from "@/lib/domain/trip";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { TripError, createTrip, listTrips } from "@/lib/repos/trips";
import { getVehicleById } from "@/lib/repos/vehicles";
import { getUserById } from "@/lib/repos/users";
import { getAssignmentById } from "@/lib/repos/assignments";
import { generateStopId } from "@/lib/domain/trip";
import type { TripPurpose, TripStatus, TripStop } from "@/lib/domain/trip";

export const runtime = "nodejs";

/**
 * GET /api/v1/trips
 * List trips. Requires trip:read.
 * Without trip:read:all, results are scoped to the authenticated user's own trips.
 * Query: ?vehicleId=&driverUserId=&tripDate=&status=&limit=
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.TRIP_READ);

    const params = request.nextUrl.searchParams;
    const limitRaw = Number(params.get("limit"));
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 500 ? limitRaw : 100;

    const statusParam = params.get("status") ?? undefined;
    if (statusParam && !(TRIP_STATUSES as readonly string[]).includes(statusParam)) {
      throw ApiError.badRequest(`status must be one of: ${TRIP_STATUSES.join(", ")}`);
    }

    const tripDate = params.get("tripDate") ?? undefined;
    if (tripDate && !/^\d{4}-\d{2}-\d{2}$/.test(tripDate)) {
      throw ApiError.badRequest("tripDate must be YYYY-MM-DD format");
    }

    const vehicleId = params.get("vehicleId") ?? undefined;
    const driverUserIdParam = params.get("driverUserId") ?? undefined;

    // If the user does NOT have TRIP_READ_ALL, they can only see their own trips.
    const canReadAll = rolesHavePermission(context.user.roles, PERMISSIONS.TRIP_READ_ALL);
    let driverUserId = driverUserIdParam;
    if (!canReadAll) {
      driverUserId = context.user.id;
    }

    const trips = await listTrips({
      vehicleId,
      driverUserId,
      tripDate,
      status: statusParam as TripStatus | undefined,
      limit,
    });
    return jsonOk({ trips });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/trips
 * Create a new draft trip. Requires trip:create.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.TRIP_CREATE);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    // Required fields
    const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId.trim() : "";
    const driverUserId = typeof body.driverUserId === "string" ? body.driverUserId.trim() : "";
    const tripDate = typeof body.tripDate === "string" ? body.tripDate.trim() : "";
    const purpose = typeof body.purpose === "string" ? body.purpose.trim() : "";

    if (!vehicleId) throw ApiError.badRequest("vehicleId is required");
    if (!driverUserId) throw ApiError.badRequest("driverUserId is required");
    if (!tripDate || !/^\d{4}-\d{2}-\d{2}$/.test(tripDate)) {
      throw ApiError.badRequest("tripDate is required in YYYY-MM-DD format");
    }
    if (!purpose || !(TRIP_PURPOSES as readonly string[]).includes(purpose)) {
      throw ApiError.badRequest(`purpose must be one of: ${TRIP_PURPOSES.join(", ")}`);
    }

    // Validate vehicle exists and is ACTIVE
    const vehicle = await getVehicleById(vehicleId);
    if (!vehicle) throw ApiError.badRequest("Unknown vehicleId");
    if (vehicle.status !== "ACTIVE") {
      throw ApiError.badRequest(
        `Vehicle status is ${vehicle.status}; only ACTIVE vehicles can be assigned trips`,
      );
    }

    // Validate driver exists
    const driver = await getUserById(driverUserId);
    if (!driver) throw ApiError.badRequest("Unknown driverUserId");

    // Optional assignmentId validation
    const assignmentId =
      typeof body.assignmentId === "string" ? body.assignmentId.trim() : undefined;
    if (assignmentId) {
      const assignment = await getAssignmentById(assignmentId);
      if (!assignment) throw ApiError.badRequest("Unknown assignmentId");
      if (assignment.vehicleId !== vehicleId) {
        throw ApiError.badRequest("assignmentId does not belong to the specified vehicle");
      }
      if (assignment.driverUserId !== driverUserId) {
        throw ApiError.badRequest("assignmentId does not belong to the specified driver");
      }
    }

    // Parse stops
    if (!Array.isArray(body.stops) || body.stops.length < 2) {
      throw ApiError.badRequest("At least 2 stops are required (origin and destination)");
    }
    const stops: TripStop[] = body.stops.map(
      (s: Record<string, unknown>, index: number): TripStop => ({
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
      }),
    );

    // Optional fields
    const externalReference =
      typeof body.externalReference === "string"
        ? body.externalReference.trim().slice(0, 200)
        : undefined;
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) : undefined;
    const manualDistanceKm =
      typeof body.manualDistanceKm === "number" ? body.manualDistanceKm : undefined;
    const manualDistanceReason =
      typeof body.manualDistanceReason === "string"
        ? body.manualDistanceReason.trim().slice(0, 500)
        : undefined;

    const trip = await createTrip({
      vehicleId,
      driverUserId,
      assignmentId,
      recordedByUserId: context.user.id,
      tripDate,
      purpose: purpose as TripPurpose,
      externalReference,
      notes,
      stops,
      manualDistanceKm,
      manualDistanceReason,
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.TRIP_CREATED,
      actorId: context.user.id,
      entityType: "trip",
      entityId: trip.id,
      after: { vehicleId, driverUserId, purpose, tripDate },
      requestId,
    });

    return jsonOk({ trip }, { status: 201 });
  } catch (error) {
    if (error instanceof TripError) {
      const status =
        error.code === "NOT_FOUND" ? 404 : error.code === "VALIDATION_FAILED" ? 400 : 400;
      return jsonOk({ error: { code: error.code, message: error.message } }, { status });
    }
    return toErrorResponse(error);
  }
}
