import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { computeConsumption, isValidFuelEntry } from "@/lib/domain/fuel";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { createExpense } from "@/lib/repos/expenses";
import { createFuelEntry, listFuelEntries } from "@/lib/repos/fuel";
import { toPesewas } from "@/lib/domain/expense";
import { recordReading } from "@/lib/repos/odometers";
import { getVehicleById } from "@/lib/repos/vehicles";

export const runtime = "nodejs";

/**
 * GET /api/v1/fuel
 * Fuel history (fuel:read) with the latest defensible consumption figure
 * (full-tank-to-full-tank only). Query: ?vehicleId=&limit=
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.FUEL_READ);

    const params = request.nextUrl.searchParams;
    const limitRaw = Number(params.get("limit"));
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 500 ? limitRaw : 100;

    const entries = await listFuelEntries({
      vehicleId: params.get("vehicleId") ?? undefined,
      limit,
    });

    // Consumption from the two most recent consecutive full-tank fill-ups.
    let consumption: { kmPerLitre: number | null; reason?: string } = {
      kmPerLitre: null,
      reason: "Not enough full-tank fill-ups yet",
    };
    const fullTanks = entries.filter((e) => e.fullTank);
    if (fullTanks.length >= 2) {
      consumption = computeConsumption(fullTanks[1]!, fullTanks[0]!);
    }

    return jsonOk({ entries, consumption });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/fuel
 * Record a fuel purchase (fuel:create).
 *
 * Creates the canonical Expense for the cost (so reports count it once) and
 * records the odometer through the ledger. `clientToken` makes retried
 * submissions idempotent.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.FUEL_CREATE);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId : "";
    const transactedOn =
      typeof body.transactedOn === "string" ? body.transactedOn.slice(0, 10) : "";
    const odometerKm = Number(body.odometerKm);
    const litres = Number(body.litres);
    const fuelType = typeof body.fuelType === "string" ? body.fuelType : "PETROL";
    const currency = typeof body.currency === "string" ? body.currency.toUpperCase() : "GHS";

    if (!vehicleId) throw ApiError.badRequest("vehicleId is required");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transactedOn)) {
      throw ApiError.badRequest("transactedOn must be YYYY-MM-DD");
    }
    if (!Number.isSafeInteger(odometerKm) || odometerKm < 0) {
      throw ApiError.badRequest("odometerKm is required (non-negative integer)");
    }

    // Total: prefer explicit totalMinor; else unit price × litres via pesewas.
    let totalMinor: number;
    if (body.totalMinor !== undefined) {
      totalMinor = Number(body.totalMinor);
    } else {
      const unitMajor = Number(body.unitPrice);
      const unitMinor = toPesewas(body.unitPriceMinor ?? unitMajor);
      if (unitMinor === null || !Number.isFinite(litres) || litres <= 0) {
        throw ApiError.badRequest("Provide totalMinor or unitPrice(+litres)");
      }
      totalMinor = Math.round(unitMinor * litres);
    }

    const validation = isValidFuelEntry({ litres, totalMinor });
    if (!validation.ok) throw ApiError.badRequest(validation.message);

    const vehicle = await getVehicleById(vehicleId);
    if (!vehicle) throw ApiError.badRequest("Unknown vehicleId");

    // Odometer through the ledger (monotonicity enforced there).
    const reading = await recordReading({
      vehicleId,
      km: odometerKm,
      source: "FUEL_PURCHASE",
      recordedByUserId: context.user.id,
      effectiveAt: new Date(`${transactedOn}T12:00:00Z`),
      notes: `Fuel purchase${typeof body.station === "string" ? ` — ${body.station}` : ""}`,
      clientToken: typeof body.clientToken === "string" ? `fuel-${body.clientToken}` : undefined,
    });

    // Canonical expense for the cost — counted once in reports.
    const expense = await createExpense({
      vehicleId,
      category: "FUEL",
      amountMinor: totalMinor,
      currency,
      description: `${litres}L ${fuelType}${typeof body.station === "string" ? ` @ ${body.station}` : ""}`,
      supplierName: typeof body.station === "string" ? body.station.slice(0, 200) : undefined,
      receiptKey: typeof body.receiptKey === "string" ? body.receiptKey.slice(0, 500) : undefined,
      incurredOn: new Date(`${transactedOn}T12:00:00Z`),
      createdBy: context.user.id,
    });

    const entry = await createFuelEntry({
      vehicleId,
      transactedOn,
      odometerKm,
      odometerReadingId: reading.reading.id,
      fuelType,
      litres,
      unitPriceMinor: body.unitPriceMinor !== undefined ? Number(body.unitPriceMinor) : undefined,
      totalMinor,
      currency,
      station: typeof body.station === "string" ? body.station.slice(0, 200) : undefined,
      receiptKey: typeof body.receiptKey === "string" ? body.receiptKey.slice(0, 500) : undefined,
      fullTank: body.fullTank === true,
      expenseId: expense.id,
      recordedBy: context.user.id,
      clientToken:
        typeof body.clientToken === "string" ? body.clientToken.slice(0, 100) : undefined,
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.FUEL_RECORDED,
      actorId: context.user.id,
      entityType: "fuelEntry",
      entityId: entry.id,
      after: { vehicleId, litres, totalMinor, fullTank: entry.fullTank, expenseId: expense.id },
      requestId,
    });

    return jsonOk({ entry, expense }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
