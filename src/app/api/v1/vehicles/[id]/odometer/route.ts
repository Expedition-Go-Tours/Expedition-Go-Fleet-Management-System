import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ODOMETER_SOURCES, type OdometerSource } from "@/lib/domain/odometer";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { listReadings, recordReading, OdometerError } from "@/lib/repos/odometers";
import { getVehicleById } from "@/lib/repos/vehicles";

export const runtime = "nodejs";

/**
 * GET /api/v1/vehicles/[id]/odometer
 * The odometer ledger for a vehicle (newest effective reading first).
 * Requires odometer:read. Also returns the vehicle's current projection.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.ODOMETER_READ);

    const { id } = await params;
    const vehicle = await getVehicleById(id);
    if (!vehicle) throw ApiError.notFound("Vehicle not found");

    const limitRaw = Number(request.nextUrl.searchParams.get("limit"));
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 500 ? limitRaw : 100;

    const readings = await listReadings(id, { limit });
    return jsonOk({
      readings,
      currentOdometerKm: vehicle.odometerKm,
      odometerAt: vehicle.odometerAt ?? null,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/vehicles/[id]/odometer
 * Record an odometer reading. Requires odometer:record.
 *
 * The reading and the vehicle projection update happen in ONE transaction;
 * retries are idempotent via `clientToken`. Live readings may never decrease;
 * historical imports are validated against neighbours and flagged on conflict.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.ODOMETER_RECORD);

    const { id } = await params;
    const vehicle = await getVehicleById(id);
    if (!vehicle) throw ApiError.notFound("Vehicle not found");
    if (vehicle.status === "ARCHIVED") {
      throw ApiError.conflict("Cannot record odometer readings for an archived vehicle");
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const km = Number(body.km);
    const source = typeof body.source === "string" ? body.source : "MANUAL_ENTRY";
    if (!(ODOMETER_SOURCES as readonly string[]).includes(source)) {
      throw ApiError.badRequest(`Source must be one of: ${ODOMETER_SOURCES.join(", ")}`);
    }

    let effectiveAt = new Date();
    if (body.effectiveAt !== undefined) {
      const parsed = new Date(String(body.effectiveAt));
      if (Number.isNaN(parsed.getTime())) {
        throw ApiError.badRequest("effectiveAt must be a valid date");
      }
      if (parsed.getTime() > Date.now() + 60_000) {
        throw ApiError.badRequest("effectiveAt cannot be in the future");
      }
      effectiveAt = parsed;
    }

    // Only drivers/ops with an active assignment may tag it; anyone with
    // odometer:record can record a manual reading.
    const result = await recordReading({
      vehicleId: id,
      km,
      source: source as OdometerSource,
      recordedByUserId: context.user.id,
      effectiveAt,
      assignmentId: typeof body.assignmentId === "string" ? body.assignmentId : undefined,
      inspectionId: typeof body.inspectionId === "string" ? body.inspectionId : undefined,
      serviceRecordId: typeof body.serviceRecordId === "string" ? body.serviceRecordId : undefined,
      fuelEntryId: typeof body.fuelEntryId === "string" ? body.fuelEntryId : undefined,
      notes: typeof body.notes === "string" ? body.notes.slice(0, 1000) : undefined,
      clientToken:
        typeof body.clientToken === "string" ? body.clientToken.slice(0, 100) : undefined,
    });

    if (!result.duplicate) {
      await writeAuditEvent({
        eventType: AUDIT_EVENTS.ODOMETER_RECORDED,
        actorId: context.user.id,
        entityType: "odometerReading",
        entityId: result.reading.id,
        after: {
          vehicleId: id,
          km: result.reading.km,
          source,
          deltaKm: result.reading.deltaKm ?? null,
          newProjection: result.newProjectionKm,
        },
        requestId,
      });
    }

    return jsonOk(
      {
        reading: result.reading,
        currentOdometerKm: result.newProjectionKm,
        duplicate: result.duplicate,
        flagged: result.reading.status === "FLAGGED",
        conflictNote: result.reading.conflictNote ?? null,
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof OdometerError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.code === "DECREASE_REJECTED" ? 409 : 400 },
      );
    }
    return toErrorResponse(error);
  }
}
