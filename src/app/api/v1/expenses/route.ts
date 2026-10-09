import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { EXPENSE_CATEGORIES, isValidAmountMinor, type ExpenseStatus } from "@/lib/domain/expense";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { createExpense, listExpenses } from "@/lib/repos/expenses";
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
    if (statusParam && !["PENDING", "APPROVED", "PAID", "VOID"].includes(statusParam)) {
      throw ApiError.badRequest("status must be PENDING, APPROVED, PAID or VOID");
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
 * Record an expense against a work order. Requires expense:create.
 * Amount is given as a decimal string/number in major units and stored as
 * integer minor units (never floats in the ledger).
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.EXPENSE_CREATE);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const workOrderId = typeof body.workOrderId === "string" ? body.workOrderId.trim() : "";
    const category = typeof body.category === "string" ? body.category : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "GHS";

    if (!workOrderId) throw ApiError.badRequest("workOrderId is required");
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

    // Convert major → minor units exactly (string-based to dodge float drift).
    const amountRaw = body.amount;
    let amountMinor: number;
    if (typeof amountRaw === "number" && Number.isFinite(amountRaw)) {
      amountMinor = Math.round(amountRaw * 10 ** exponent);
    } else if (typeof amountRaw === "string" && /^\d+(\.\d{1,4})?$/.test(amountRaw.trim())) {
      const [whole, frac = ""] = amountRaw.trim().split(".");
      amountMinor = Number(whole) * 10 ** exponent + Number((frac + "0000").slice(0, exponent));
    } else {
      throw ApiError.badRequest("amount must be a positive number (major units)");
    }
    if (!isValidAmountMinor(amountMinor)) {
      throw ApiError.badRequest("amount is out of range or invalid");
    }

    const workOrder = await getWorkOrderById(workOrderId);
    if (!workOrder) throw ApiError.badRequest("Unknown workOrderId");

    const expense = await createExpense({
      workOrderId,
      vehicleId: workOrder.vehicleId,
      category: category as import("@/lib/domain/expense").Expense["category"],
      amountMinor,
      currency,
      description,
      createdBy: context.user.id,
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.EXPENSE_CREATED,
      actorId: context.user.id,
      entityType: "expense",
      entityId: expense.id,
      after: { workOrderId, category, currency, amountMinor },
      requestId,
    });

    return jsonOk({ expense }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
