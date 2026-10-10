import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ASSIGNMENT_PURPOSES } from "@/lib/domain/assignment";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import {
  getActiveAssignmentForDriver,
  getActiveAssignmentForVehicle,
  listAssignments,
  startAssignment,
} from "@/lib/repos/assignments";
import { getVehicleById } from "@/lib/repos/vehicles";
import { recordReading } from "@/lib/repos/odometers";

export const runtime = "nodejs";

/**
 * GET /api/v1/assignments
 * List assignments (assignment:read). Drivers see their own by default;
 * staff with the permission see all. Query: ?vehicleId=&driverUserId=&status=&limit=
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.ASSIGNMENT_READ);

    const params = request.nextUrl.searchParams;
    const limitRaw = Number(params.get("limit"));
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 500 ? limitRaw : 100;
    const statusParam = params.get("status");
    if (statusParam && !["ACTIVE", "COMPLETED", "CANCELLED"].includes(statusParam)) {
      throw ApiError.badRequest("status must be ACTIVE, COMPLETED or CANCELLED");
    }

    // Drivers without assignment:create only ever see their own assignments.
    const { rolesHavePermission } = await import("@/lib/auth/permissions");
    const canSeeAll = rolesHavePermission(context.user.roles, PERMISSIONS.ASSIGNMENT_CREATE);
    const driverUserId = canSeeAll ? (params.get("driverUserId") ?? undefined) : context.user.id;

    const assignments = await listAssignments({
      vehicleId: params.get("vehicleId") ?? undefined,
      driverUserId,
      status: (statusParam as "ACTIVE" | "COMPLETED" | "CANCELLED" | null) ?? undefined,
      limit,
    });
    return jsonOk({ assignments });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/assignments
 * Start a journey / record vehicle use (assignment:start or assignment:create).
 *
 * Enforced server-side: the vehicle must not be on safety hold, must not
 * already have an active assignment, and the driver must not already be on
 * one. The start odometer is captured through the ledger.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    const { rolesHavePermission } = await import("@/lib/auth/permissions");
    // Drivers can start their OWN assignment; staff can start any.
    const canAssignOthers = rolesHavePermission(context.user.roles, PERMISSIONS.ASSIGNMENT_CREATE);
    if (
      !canAssignOthers &&
      !rolesHavePermission(context.user.roles, PERMISSIONS.ASSIGNMENT_START)
    ) {
      throw ApiError.forbidden("Missing permission: assignment:start");
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId : "";
    const driverUserId =
      typeof body.driverUserId === "string" ? body.driverUserId : context.user.id;
    const purpose = typeof body.purpose === "string" ? body.purpose : "OTHER";
    const startOdometerKm = Number(body.startOdometerKm);

    if (!vehicleId) throw ApiError.badRequest("vehicleId is required");
    if (!(ASSIGNMENT_PURPOSES as readonly string[]).includes(purpose)) {
      throw ApiError.badRequest(`purpose must be one of: ${ASSIGNMENT_PURPOSES.join(", ")}`);
    }
    if (!Number.isSafeInteger(startOdometerKm) || startOdometerKm < 0) {
      throw ApiError.badRequest("startOdometerKm is required (non-negative integer)");
    }
    if (!canAssignOthers && driverUserId !== context.user.id) {
      throw ApiError.forbidden("Drivers can only start assignments for themselves");
    }

    const vehicle = await getVehicleById(vehicleId);
    if (!vehicle) throw ApiError.badRequest("Unknown vehicleId");
    if (vehicle.status === "ARCHIVED") {
      throw ApiError.conflict("Cannot assign an archived vehicle");
    }
    if (vehicle.status === "SAFETY_HOLD") {
      throw ApiError.conflict(
        vehicle.safetyHoldReason
          ? `Vehicle is on safety hold: ${vehicle.safetyHoldReason}`
          : "Vehicle is on safety hold",
      );
    }
    if (vehicle.status === "IN_SERVICE") {
      throw ApiError.conflict("Vehicle is in the workshop");
    }

    // One active assignment per vehicle and per driver.
    const existingForVehicle = await getActiveAssignmentForVehicle(vehicleId);
    if (existingForVehicle) {
      throw ApiError.conflict("Vehicle already has an active assignment");
    }
    const existingForDriver = await getActiveAssignmentForDriver(driverUserId);
    if (existingForDriver) {
      throw ApiError.conflict("Driver already has an active assignment");
    }

    // Start odometer through the ledger (transactional with its own checks).
    const reading = await recordReading({
      vehicleId,
      km: startOdometerKm,
      source: "TRIP_START",
      recordedByUserId: context.user.id,
      notes: `Assignment start — ${purpose}`,
      clientToken:
        typeof body.clientToken === "string" ? body.clientToken.slice(0, 100) : undefined,
    });

    const assignment = await startAssignment({
      vehicleId,
      driverUserId,
      purpose: purpose as import("@/lib/domain/assignment").AssignmentPurpose,
      externalReference:
        typeof body.externalReference === "string"
          ? body.externalReference.slice(0, 200)
          : undefined,
      notes: typeof body.notes === "string" ? body.notes.slice(0, 1000) : undefined,
      startOdometerKm,
      startOdometerReadingId: reading.reading.id,
      createdBy: context.user.id,
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.ASSIGNMENT_STARTED,
      actorId: context.user.id,
      entityType: "assignment",
      entityId: assignment.id,
      after: { vehicleId, driverUserId, purpose, startOdometerKm },
      requestId,
    });

    return jsonOk({ assignment }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
