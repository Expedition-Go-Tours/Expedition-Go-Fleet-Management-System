import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  getServiceRecordById,
  linkExpenseToServiceRecord,
  listServiceRecords,
} from "@/lib/repos/maintenance";
import { ServiceLogError, logService, resolveServiceOdometer } from "@/lib/domain/service-logging";
import { resolveRepairCost } from "@/lib/domain/work-order-completion";
import {
  ensureServiceExpense,
  findExpenseByServiceRecordId,
  getExpenseById,
} from "@/lib/repos/expenses";
import { recordServiceCost } from "@/lib/domain/service-cost";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

/**
 * GET /api/v1/service-records
 * Completed service history (service:read).
 * Query: ?vehicleId= (required for now), ?workOrderId=
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.SERVICE_READ);

    const params = request.nextUrl.searchParams;
    const vehicleId = params.get("vehicleId");
    const workOrderId = params.get("workOrderId");

    if (workOrderId) {
      const { listWorkOrders } = await import("@/lib/repos/work-orders");
      const workOrders = await listWorkOrders({ limit: 2000 });
      const wo = workOrders.find((w) => w.id === workOrderId);
      if (!wo) throw ApiError.notFound("Work order not found");
      const record = wo.serviceRecordId ? await getServiceRecordById(wo.serviceRecordId) : null;
      return jsonOk({ serviceRecords: record ? [record] : [] });
    }

    if (!vehicleId) throw ApiError.badRequest("vehicleId or workOrderId is required");
    const serviceRecords = await listServiceRecords(vehicleId);
    return jsonOk({ serviceRecords });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/service-records
 * Log maintenance that already happened (service:record) — a garage visit or
 * breakdown repair recorded directly, without creating a work order first.
 *
 * Writes the same ServiceRecord, schedule-baseline resets and — when an
 * odometer is supplied — the same odometer ledger entry as work-order
 * completion, so service history never cares which path recorded it. Without
 * an odometer the record keeps its reading unknown and no ledger entry is
 * written. An optional repair cost is stored as a canonical MAINTENANCE
 * expense linked to the record. `clientToken` makes retries idempotent.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.SERVICE_RECORD);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId.trim() : "";
    const workPerformed = typeof body.workPerformed === "string" ? body.workPerformed.trim() : "";
    // Optional: a garage receipt may not carry a reading. Absent → no ledger
    // entry, never a fabricated 0.
    const odometerKm = resolveServiceOdometer(body.odometerKm);
    if (!vehicleId) throw ApiError.badRequest("vehicleId is required");

    let completedAt = new Date();
    if (body.completedAt !== undefined && body.completedAt !== "") {
      const candidate = new Date(String(body.completedAt));
      if (Number.isNaN(candidate.getTime())) {
        throw ApiError.badRequest("completedAt must be a valid date");
      }
      if (candidate.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
        throw ApiError.badRequest("completedAt cannot be in the future");
      }
      completedAt = candidate;
    }

    const scheduleIds = Array.isArray(body.scheduleIds)
      ? body.scheduleIds.filter((s): s is string => typeof s === "string").slice(0, 20)
      : [];
    // Optional repair cost, recorded as a canonical MAINTENANCE expense.
    const repairCost = resolveRepairCost({ costMinor: body.costMinor, currency: body.currency });

    const result = await logService({
      vehicleId,
      taskName: typeof body.taskName === "string" ? body.taskName.slice(0, 200) : undefined,
      completedAt,
      odometerKm,
      workPerformed,
      providerName:
        typeof body.providerName === "string" ? body.providerName.slice(0, 200) : undefined,
      technicianName:
        typeof body.technicianName === "string" ? body.technicianName.slice(0, 200) : undefined,
      notes: typeof body.notes === "string" ? body.notes.slice(0, 2000) : undefined,
      scheduleIds,
      recordedByUserId: context.user.id,
      clientToken: typeof body.clientToken === "string" ? body.clientToken : undefined,
      repairCost: repairCost ?? undefined,
    });

    let expense: Awaited<ReturnType<typeof getExpenseById>> = null;
    if (!result.duplicate) {
      await writeAuditEvent({
        eventType: AUDIT_EVENTS.SERVICE_RECORDED,
        actorId: context.user.id,
        entityType: "serviceRecord",
        entityId: result.serviceRecord.id,
        after: {
          vehicleId,
          odometerKm: odometerKm ?? null,
          resetScheduleIds: result.resetScheduleIds,
          direct: true,
        },
        requestId,
      });
    }

    // Reconcile the optional cost on every attempt (see the work-order route).
    // A duplicate log or a retried failed request reuses the same expense.
    const effectiveCost =
      repairCost ??
      (result.serviceRecord.repairCostMinor !== undefined && result.serviceRecord.repairCostCurrency
        ? {
            amountMinor: result.serviceRecord.repairCostMinor,
            currency: result.serviceRecord.repairCostCurrency,
          }
        : null);

    if (effectiveCost) {
      try {
        const existingExpenseId =
          result.serviceRecord.expenseIds[0] ??
          (await findExpenseByServiceRecordId(result.serviceRecord.id))?.id;
        const cost = await recordServiceCost(
          {
            ensureExpense: async (record) => {
              const ensured = await ensureServiceExpense({
                id: record.id,
                vehicleId: record.vehicleId,
                workOrderId: record.workOrderId,
                serviceRecordId: record.serviceRecordId,
                category: record.category,
                amountMinor: record.amountMinor,
                currency: record.currency,
                description: record.description,
                supplierName: record.supplierName,
                providerId: record.providerId,
                incurredOn: record.incurredOn,
                createdBy: record.createdBy,
              });
              return { expenseId: ensured.expense.id, created: ensured.created };
            },
            linkServiceRecord: linkExpenseToServiceRecord,
          },
          {
            serviceRecordId: result.serviceRecord.id,
            vehicleId,
            amountMinor: effectiveCost.amountMinor,
            currency: effectiveCost.currency,
            description: workPerformed,
            supplierName:
              typeof body.providerName === "string" ? body.providerName.slice(0, 200) : undefined,
            incurredOn: completedAt,
            createdBy: context.user.id,
            existingExpenseId,
          },
        );
        expense = await getExpenseById(cost.expenseId);

        if (cost.created) {
          await writeAuditEvent({
            eventType: AUDIT_EVENTS.EXPENSE_CREATED,
            actorId: context.user.id,
            entityType: "expense",
            entityId: cost.expenseId,
            after: {
              vehicleId,
              category: "MAINTENANCE",
              amountMinor: effectiveCost.amountMinor,
              currency: effectiveCost.currency,
              serviceRecordId: result.serviceRecord.id,
            },
            requestId,
          });
        }
      } catch (costError) {
        console.error("[service-logging] cost not recorded; retry will recover", costError);
        return NextResponse.json(
          {
            error: {
              code: "COST_NOT_RECORDED",
              message:
                "The service was recorded, but its cost could not be saved. Submit it again to finish the cost — the service will not be duplicated.",
            },
            serviceRecord: result.serviceRecord,
            duplicate: result.duplicate,
            retryable: true,
          },
          { status: 502 },
        );
      }
    }

    return jsonOk(
      { serviceRecord: result.serviceRecord, duplicate: result.duplicate, expense },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof ServiceLogError) {
      const status =
        error.code === "VEHICLE_NOT_FOUND" || error.code === "SCHEDULE_NOT_FOUND"
          ? 404
          : error.code === "DECREASE_REJECTED"
            ? 409
            : 400;
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
    }
    return toErrorResponse(error);
  }
}
