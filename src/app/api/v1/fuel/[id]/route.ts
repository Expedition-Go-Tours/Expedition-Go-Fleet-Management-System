import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { parseDeletionReason } from "@/lib/domain/deletion";
import { parsePaidTo } from "@/lib/domain/expense";
import { FUEL_TYPES_SUPPORTED, isValidFuelEntry } from "@/lib/domain/fuel";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { correctFuelEntry, deleteFuelEntryRecord, FuelEntryError } from "@/lib/repos/fuel";

export const runtime = "nodejs";

/**
 * PATCH /api/v1/fuel/[id]
 * Correct a recorded fuel purchase (fuel:update — operations and admin).
 *
 * Only the editable fields are replaced: date, amount, fuel type, station,
 * payee and full-tank flag. The vehicle, odometer/reading link and recorded-by
 * stamp are immutable; a wrong odometer is corrected through the odometer
 * ledger so the mileage history stays append-only. The linked canonical
 * expense is updated in the same transaction, keeping fuel spend and the
 * finance ledger in agreement. Every correction is audited with before/after.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.FUEL_UPDATE);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const transactedOn =
      typeof body.transactedOn === "string" ? body.transactedOn.slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transactedOn)) {
      throw ApiError.badRequest("transactedOn must be YYYY-MM-DD");
    }

    const totalMinor = Number(body.totalMinor);
    const amountCheck = isValidFuelEntry({ totalMinor });
    if (!amountCheck.ok) throw ApiError.badRequest(amountCheck.message);

    const fuelType = typeof body.fuelType === "string" ? body.fuelType.trim() : "";
    if (!FUEL_TYPES_SUPPORTED.some((type) => type === fuelType)) {
      throw ApiError.badRequest("Unsupported fuel type");
    }

    // Replaced, not merged: an omitted station/payee clears it, matching the
    // edit form where the operator sees (and can empty) the current value.
    const station =
      typeof body.station === "string" ? body.station.trim().slice(0, 200) : undefined;
    const paidToResult = parsePaidTo(body.paidTo);
    if (!paidToResult.ok) throw ApiError.badRequest(paidToResult.message);
    const paidTo = paidToResult.paidTo;

    const result = await correctFuelEntry({
      id,
      transactedOn,
      totalMinor,
      fuelType,
      station: station || undefined,
      paidTo,
      fullTank: body.fullTank === true,
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.FUEL_CORRECTED,
      actorId: context.user.id,
      entityType: "fuelEntry",
      entityId: result.after.id,
      before: {
        transactedOn: result.before.transactedOn,
        totalMinor: result.before.totalMinor,
        fuelType: result.before.fuelType,
        station: result.before.station ?? null,
        paidTo: result.before.paidTo ?? null,
        fullTank: result.before.fullTank,
      },
      after: {
        transactedOn: result.after.transactedOn,
        totalMinor: result.after.totalMinor,
        fuelType: result.after.fuelType,
        station: result.after.station ?? null,
        paidTo: result.after.paidTo ?? null,
        fullTank: result.after.fullTank,
        expenseId: result.after.expenseId ?? null,
      },
      requestId,
    });

    return jsonOk({ fuelEntry: result.after });
  } catch (error) {
    if (error instanceof FuelEntryError) {
      const status = error.code === "FUEL_ENTRY_NOT_FOUND" ? 404 : 409;
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
    }
    return toErrorResponse(error);
  }
}

/**
 * DELETE /api/v1/fuel/[id]
 *
 * Permanently remove one fuel purchase (fuel:delete — ADMIN only). A written
 * reason is required and the full record is captured in the audit log. The
 * canonical expense is deleted with it; the odometer reading is kept as
 * mileage history and only loses its fuel link.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.FUEL_DELETE);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const reason = parseDeletionReason(body?.reason);

    const result = await deleteFuelEntryRecord(id, {
      eventType: AUDIT_EVENTS.FUEL_DELETED,
      actorId: context.user.id,
      entityType: "fuelEntry",
      entityId: id,
      reason,
      requestId,
    });

    return jsonOk({
      deleted: true,
      deletedExpenseId: result.deletedExpenseId ?? null,
      unlinkedOdometerReadingId: result.unlinkedOdometerReadingId ?? null,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
