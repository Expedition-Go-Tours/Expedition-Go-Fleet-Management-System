import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { getDocumentById, updateDocument } from "@/lib/repos/documents";

export const runtime = "nodejs";

/**
 * PATCH /api/v1/documents/[id]
 * Renew/replace document metadata (document:manage) — e.g. a new expiry date
 * after renewal. The metadata change is audited; the original state remains
 * in the audit trail.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.DOCUMENT_MANAGE);

    const { id } = await params;
    const existing = await getDocumentById(id);
    if (!existing) throw ApiError.notFound("Document not found");

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const fields: Parameters<typeof updateDocument>[1] = {};
    if (body.issueDate !== undefined && body.issueDate !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.issueDate))) {
        throw ApiError.badRequest("issueDate must be YYYY-MM-DD");
      }
      fields.issueDate = String(body.issueDate);
    }
    if (body.expiryDate !== undefined && body.expiryDate !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.expiryDate))) {
        throw ApiError.badRequest("expiryDate must be YYYY-MM-DD");
      }
      fields.expiryDate = String(body.expiryDate);
    }
    if (typeof body.fileKey === "string") fields.fileKey = body.fileKey.slice(0, 500);
    if (typeof body.notes === "string") fields.notes = body.notes.slice(0, 1000);
    if (body.mandatory !== undefined) fields.mandatory = body.mandatory === true;
    if (Object.keys(fields).length === 0) throw ApiError.badRequest("No updatable fields");

    fields.uploadedBy = context.user.id;
    const updated = await updateDocument(id, fields);

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.DOCUMENT_UPDATED,
      actorId: context.user.id,
      entityType: "vehicleDocument",
      entityId: id,
      before: { expiryDate: existing.expiryDate ?? null },
      after: { expiryDate: updated.expiryDate ?? null },
      requestId,
    });

    return jsonOk({ document: updated });
  } catch (error) {
    return toErrorResponse(error);
  }
}
