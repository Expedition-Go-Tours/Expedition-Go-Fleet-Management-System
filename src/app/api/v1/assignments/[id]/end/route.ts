import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS, rolesHavePermission } from "@/lib/auth/permissions";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import {
  completeAssignment,
  getAssignmentById,
  AssignmentConflictError,
} from "@/lib/repos/assignments";
import { recordReading, OdometerError } from "@/lib/repos/odometers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/v1/assignments/[id]/end
 * Record the end-of-trip odometer (assignment:end). Distance is computed
 * from the accepted readings — a lower end reading flags a conflict instead
 * of fabricating a negative distance.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.ASSIGNMENT_END);

    const { id } = await params;
    const assignment = await getAssignmentById(id);
    if (!assignment) throw ApiError.notFound("Assignment not found");
    if (assignment.status !== "ACTIVE") {
      throw ApiError.conflict(`Assignment is already ${assignment.status}`);
    }
    const canEndAll = rolesHavePermission(context.user.roles, PERMISSIONS.ASSIGNMENT_CREATE);
    if (!canEndAll && assignment.driverUserId !== context.user.id) {
      throw ApiError.forbidden("Drivers can only end their own assignments");
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const endOdometerKm = Number(body?.endOdometerKm);
    if (!Number.isSafeInteger(endOdometerKm) || endOdometerKm < 0) {
      throw ApiError.badRequest("endOdometerKm is required (non-negative integer)");
    }

    const reading = await recordReading({
      vehicleId: assignment.vehicleId,
      km: endOdometerKm,
      source: "TRIP_END",
      recordedByUserId: context.user.id,
      assignmentId: assignment.id,
      notes: "Assignment end",
      clientToken:
        typeof body?.clientToken === "string" ? body.clientToken.slice(0, 100) : undefined,
    });

    const completed = await completeAssignment(id, {
      endOdometerKm,
      endOdometerReadingId: reading.reading.id,
      notes: typeof body?.notes === "string" ? body.notes : undefined,
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.ASSIGNMENT_ENDED,
      actorId: context.user.id,
      entityType: "assignment",
      entityId: id,
      after: { endOdometerKm, distanceKm: completed.distanceKm ?? null },
      requestId,
    });

    return jsonOk({ assignment: completed });
  } catch (error) {
    if (error instanceof AssignmentConflictError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: 409 },
      );
    }
    if (error instanceof OdometerError) {
      // A lower end reading than the ledger projection is a conflict, not a
      // fabricated (negative) distance.
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.code === "DECREASE_REJECTED" ? 409 : 400 },
      );
    }
    return toErrorResponse(error);
  }
}
