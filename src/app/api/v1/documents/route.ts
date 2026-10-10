import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { DOCUMENT_CATEGORIES, documentState } from "@/lib/domain/document";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { createDocument, listDocuments } from "@/lib/repos/documents";
import { getVehicleById } from "@/lib/repos/vehicles";

export const runtime = "nodejs";

/** Configurable expiry warning window (days) — company policy, not law. */
const EXPIRY_WARNING_DAYS = Number(process.env.DOCUMENT_EXPIRY_WARNING_DAYS ?? 30);

/**
 * GET /api/v1/documents?vehicleId=…
 * Vehicle documents with computed expiry states (document:read).
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.DOCUMENT_READ);

    const vehicleId = request.nextUrl.searchParams.get("vehicleId");
    if (!vehicleId) throw ApiError.badRequest("vehicleId is required");
    const vehicle = await getVehicleById(vehicleId);
    if (!vehicle) throw ApiError.notFound("Vehicle not found");

    const now = new Date();
    const documents = (await listDocuments(vehicleId)).map((doc) => ({
      ...doc,
      state: documentState(doc, now, EXPIRY_WARNING_DAYS),
    }));
    return jsonOk({ documents, warningDays: EXPIRY_WARNING_DAYS });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/documents
 * Register/upload a vehicle document reference (document:upload).
 * File storage is an integration boundary: `fileKey` is a private-storage
 * key supplied by the upload service — this endpoint never fabricates
 * successful uploads or public URLs.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.DOCUMENT_UPLOAD);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId : "";
    const category = typeof body.category === "string" ? body.category : "";
    if (!vehicleId) throw ApiError.badRequest("vehicleId is required");
    if (!(DOCUMENT_CATEGORIES as readonly string[]).includes(category)) {
      throw ApiError.badRequest(`category must be one of: ${DOCUMENT_CATEGORIES.join(", ")}`);
    }
    const vehicle = await getVehicleById(vehicleId);
    if (!vehicle) throw ApiError.badRequest("Unknown vehicleId");

    for (const field of ["issueDate", "expiryDate"] as const) {
      const value = body[field];
      if (value !== undefined && value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        throw ApiError.badRequest(`${field} must be YYYY-MM-DD`);
      }
    }

    const document = await createDocument({
      vehicleId,
      category,
      issueDate: typeof body.issueDate === "string" ? body.issueDate : undefined,
      expiryDate: typeof body.expiryDate === "string" ? body.expiryDate : undefined,
      fileKey: typeof body.fileKey === "string" ? body.fileKey.slice(0, 500) : undefined,
      notes: typeof body.notes === "string" ? body.notes.slice(0, 1000) : undefined,
      mandatory: body.mandatory === true,
      uploadedBy: context.user.id,
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.DOCUMENT_UPLOADED,
      actorId: context.user.id,
      entityType: "vehicleDocument",
      entityId: document.id,
      after: { vehicleId, category, expiryDate: document.expiryDate ?? null },
      requestId,
    });

    return jsonOk({ document }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
