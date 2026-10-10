import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  EXPENSE_CATEGORIES,
  isValidAmountMinor,
  toPesewas,
  type ExpenseStatus,
} from "@/lib/domain/expense";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { createExpense, listExpenses } from "@/lib/repos/expenses";
import { getVehicleById } from "@/lib/repos/vehicles";
import { getWorkOrderById } from "@/lib/repos/work-orders";

export const runtime = "nodejs";

/** Supported minor-unit exponent per currency (amount = major × 10^exponent). */
const CURRENCY_EXPONENT: Record<string, number> = { GHS: 2, USD: 2, EUR: 2 };

/**
 * GET /api/v1/expenses
 * List expenses. Requires expense:read.
 * Query: ?workOrderId=&vehicleId=&status=&limit=
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.EXPENSE_READ);

    const params = request.nextUrl.searchParams;
    const limitRaw = Number(params.get("limit"));
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 1000 ? limitRaw : 200;
    const statusParam = params.get("status");
    if (statusParam && !["RECORDED", "VOID"].includes(statusParam)) {
      throw ApiError.badRequest("status must be RECORDED or VOID");
    }

    const expenses = await listExpenses({
      workOrderId: params.get("workOrderId") ?? undefined,
      vehicleId: params.get("vehicleId") ?? undefined,
      status: (statusParam as ExpenseStatus | null) ?? undefined,
      limit,
    });
    return jsonOk({ expenses });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/expenses
 * Record an expense. Requires expense:create.
 *
 * The VEHICLE is the primary association; a work order is optional context
 * (repair costs may be logged before/without a work order, and general costs
 * like insurance never have one). Approval happens outside this system, so a
 * new expense is always RECORDED. Amount is given as a decimal string/number
 * in major units and stored as integer minor units (never floats).
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.EXPENSE_CREATE);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const vehicleIdInput = typeof body.vehicleId === "string" ? body.vehicleId.trim() : "";
    const workOrderId = typeof body.workOrderId === "string" ? body.workOrderId.trim() : "";
    const category = typeof body.category === "string" ? body.category : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "GHS";
    const supplierName =
      typeof body.supplierName === "string" ? body.supplierName.trim().slice(0, 200) : "";
    const externalReference =
      typeof body.externalReference === "string" ? body.externalReference.trim().slice(0, 200) : "";

    if (!vehicleIdInput && !workOrderId) {
      throw ApiError.badRequest("vehicleId is required (workOrderId alone is also accepted)");
    }
    if (!(EXPENSE_CATEGORIES as readonly string[]).includes(category)) {
      throw ApiError.badRequest(`Category must be one of: ${EXPENSE_CATEGORIES.join(", ")}`);
    }
    if (!description || description.length > 500) {
      throw ApiError.badRequest("Description is required (max 500 chars)");
    }
    const exponent = CURRENCY_EXPONENT[currency];
    if (exponent === undefined) {
      throw ApiError.badRequest(
        `Unsupported currency. Supported: ${Object.keys(CURRENCY_EXPONENT).join(", ")}`,
      );
    }

    let incurredOn: Date | undefined;
    const incurredRaw = typeof body.incurredOn === "string" ? body.incurredOn.trim() : "";
    if (incurredRaw) {
      const parsed = new Date(incurredRaw);
      if (Number.isNaN(parsed.getTime()))
        throw ApiError.badRequest("incurredOn must be a valid date");
      incurredOn = parsed;
    }

    // Convert major → minor units exactly (single domain helper, no float drift).
    const amountMinor = toPesewas(body.amount, exponent);
    if (amountMinor === null || !isValidAmountMinor(amountMinor)) {
      throw ApiError.badRequest("amount must be a positive number (major units)");
    }

    // Resolve the vehicle link. A work order, when supplied, contributes its
    // vehicleId but must not contradict an explicitly supplied vehicle.
    let vehicleId = vehicleIdInput;
    if (workOrderId) {
      const workOrder = await getWorkOrderById(workOrderId);
      if (!workOrder) throw ApiError.badRequest("Unknown workOrderId");
      if (vehicleId && workOrder.vehicleId !== vehicleId) {
        throw ApiError.badRequest("vehicleId does not match the work order's vehicle");
      }
      vehicleId = vehicleId || workOrder.vehicleId;
    }
    const vehicle = await getVehicleById(vehicleId);
    if (!vehicle) throw ApiError.badRequest("Unknown vehicleId");

    const expense = await createExpense({
      vehicleId,
      workOrderId: workOrderId || undefined,
      category: category as import("@/lib/domain/expense").Expense["category"],
      amountMinor,
      currency,
      description,
      supplierName: supplierName || undefined,
      externalReference: externalReference || undefined,
      incurredOn,
      createdBy: context.user.id,
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.EXPENSE_CREATED,
      actorId: context.user.id,
      entityType: "expense",
      entityId: expense.id,
      after: { vehicleId, workOrderId: workOrderId || null, category, currency, amountMinor },
      requestId,
    });

    return jsonOk({ expense }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
