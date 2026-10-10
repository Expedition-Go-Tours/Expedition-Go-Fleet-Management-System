import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { correctReading, OdometerError } from "@/lib/repos/odometers";

export const runtime = "nodejs";

/**
 * POST /api/v1/odometer/[id]/correct
 * Correct an accepted odometer reading. Requires odometer:correct.
 *
 * The original is superseded — never deleted — with actor, reason and a link
 * to the replacement. The vehicle projection is recomputed from the remaining
 * accepted ledger. Both writes happen in one transaction.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.ODOMETER_CORRECT);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const correctedKm = Number(body.correctedKm);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason || reason.length > 1000) {
      throw ApiError.badRequest("A correction reason is required (max 1000 chars)");
    }

    const result = await correctReading({
      readingId: id,
      correctedKm,
      reason,
      correctedByUserId: context.user.id,
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.ODOMETER_CORRECTED,
      actorId: context.user.id,
      entityType: "odometerReading",
      entityId: id,
      before: { km: result.original.km },
      after: { km: result.replacement.km },
      reason,
      requestId,
    });

    return jsonOk({
      original: result.original,
      replacement: result.replacement,
    });
  } catch (error) {
    if (error instanceof OdometerError) {
      const status =
        error.code === "READING_NOT_FOUND" ? 404 : error.code === "INVALID_KM" ? 400 : 409;
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
    }
    return toErrorResponse(error);
  }
}
