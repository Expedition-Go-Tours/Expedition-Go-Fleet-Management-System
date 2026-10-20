import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  ALLOWED_UPLOAD_TYPES,
  isCloudinaryConfigured,
  MAX_UPLOAD_BYTES,
  sniffContentType,
  uploadDocument,
} from "@/lib/cloudinary";
import { DOCUMENT_CATEGORIES, documentState } from "@/lib/domain/document";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { createDocument } from "@/lib/repos/documents";
import { getVehicleById } from "@/lib/repos/vehicles";

export const runtime = "nodejs";

/** Configurable expiry warning window (days) — company policy, not law. */
const EXPIRY_WARNING_DAYS = Number(process.env.DOCUMENT_EXPIRY_WARNING_DAYS ?? 30);

/**
 * POST /api/v1/documents/upload
 * Upload a document file and register it against a vehicle in one step
 * (multipart/form-data). Requires `document:upload`.
 *
 * Fields: file, vehicleId, category, issueDate?, expiryDate?, notes?, mandatory?
 *
 * The file goes to Cloudinary under `type=authenticated` — not publicly
 * readable — and only the returned signed delivery URL is kept on the record.
 * The API never fabricates a successful upload: if storage rejects the file or
 * is not configured, the request fails and no record is created.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.DOCUMENT_UPLOAD);

    if (!isCloudinaryConfigured()) {
      throw ApiError.serviceUnavailable(
        "Document uploads are not configured yet. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.",
        "UPLOADS_NOT_CONFIGURED",
      );
    }

    const form = await request.formData().catch(() => null);
    if (!form) throw ApiError.badRequest("Expected multipart/form-data");

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw ApiError.badRequest("A file is required");
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw ApiError.badRequest(
        `File is too large (${Math.round(file.size / 1024 / 1024)} MB). Maximum is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
      );
    }
    const contentType = file.type || "application/octet-stream";
    if (!(contentType in ALLOWED_UPLOAD_TYPES)) {
      throw ApiError.badRequest(
        `Unsupported file type "${contentType}". Allowed: ${Object.keys(ALLOWED_UPLOAD_TYPES).join(", ")}.`,
      );
    }

    const vehicleId = String(form.get("vehicleId") ?? "");
    const category = String(form.get("category") ?? "");
    if (!vehicleId) throw ApiError.badRequest("vehicleId is required");
    if (!(DOCUMENT_CATEGORIES as readonly string[]).includes(category)) {
      throw ApiError.badRequest(`category must be one of: ${DOCUMENT_CATEGORIES.join(", ")}`);
    }
    const vehicle = await getVehicleById(vehicleId);
    if (!vehicle) throw ApiError.badRequest("Unknown vehicleId");

    for (const field of ["issueDate", "expiryDate"] as const) {
      const value = form.get(field);
      if (
        value !== undefined &&
        value !== null &&
        value !== "" &&
        !/^\d{4}-\d{2}-\d{2}$/.test(String(value))
      ) {
        throw ApiError.badRequest(`${field} must be YYYY-MM-DD`);
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // The browser's Content-Type is untrusted — verify the bytes really are a
    // document before anything is stored.
    const detected = sniffContentType(buffer);
    if (!detected) {
      throw ApiError.badRequest(
        "That file is not a readable PDF or image. Check the file and try again.",
        "UNSUPPORTED_FILE_CONTENT",
      );
    }
    if (detected !== contentType) {
      throw ApiError.badRequest(
        `File contents (${detected}) do not match the reported type (${contentType}). Upload the original file.`,
        "FILE_TYPE_MISMATCH",
      );
    }

    let stored;
    try {
      stored = await uploadDocument({
        buffer,
        filename: file.name || "document",
        contentType,
      });
    } catch (uploadError) {
      // Type and size are already validated above, so anything left is the
      // storage service failing or rejecting us. Surface the real reason rather
      // than a generic 500 — the user needs to know whether to retry.
      throw ApiError.serviceUnavailable(
        uploadError instanceof Error ? uploadError.message : "Upload failed",
        "UPLOAD_FAILED",
      );
    }

    const document = await createDocument({
      vehicleId,
      category,
      issueDate: String(form.get("issueDate") ?? "") || undefined,
      expiryDate: String(form.get("expiryDate") ?? "") || undefined,
      fileKey: stored.publicId,
      fileUrl: stored.secureUrl,
      fileName: file.name || "document",
      fileSize: stored.bytes,
      fileType: contentType,
      notes: String(form.get("notes") ?? "").slice(0, 1000) || undefined,
      mandatory: form.get("mandatory") === "true",
      uploadedBy: context.user.id,
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.DOCUMENT_UPLOADED,
      actorId: context.user.id,
      entityType: "vehicleDocument",
      entityId: document.id,
      after: {
        vehicleId,
        category,
        expiryDate: document.expiryDate ?? null,
        fileName: document.fileName ?? null,
      },
      requestId,
    });

    return jsonOk(
      {
        document: {
          ...document,
          state: documentState(document, new Date(), EXPIRY_WARNING_DAYS),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
