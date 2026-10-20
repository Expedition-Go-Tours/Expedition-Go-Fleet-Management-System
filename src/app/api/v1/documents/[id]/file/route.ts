import { NextRequest } from "next/server";

import { ApiError, toErrorResponse } from "@/lib/api/errors";
import { requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { resolveDeliveryUrl } from "@/lib/cloudinary";
import { getDocumentById, updateDocument } from "@/lib/repos/documents";

export const runtime = "nodejs";

/**
 * GET /api/v1/documents/[id]/file
 * View/download the file behind a vehicle document (document:read).
 *
 * Authorization happens here, not at the CDN: the stored URL is Cloudinary's
 * signed, non-public delivery URL, and it is only handed out after the caller's
 * permission has been checked. Redirecting keeps the file bytes off our server —
 * the CDN streams them directly.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.DOCUMENT_READ);

    const { id } = await params;
    const document = await getDocumentById(id);
    if (!document) throw ApiError.notFound("Document not found");

    // Fast path is the URL Cloudinary signed at upload time. If it is missing
    // (or an API-secret rotation invalidated it), re-resolve a fresh signed URL
    // from the stored key and keep it, so documents survive a rotation.
    let fileUrl = document.fileUrl;
    if (!fileUrl && document.fileKey) {
      fileUrl = (await resolveDeliveryUrl(document.fileKey)) ?? undefined;
      if (fileUrl) await updateDocument(document.id, { fileUrl });
    }
    if (!fileUrl) {
      throw ApiError.notFound(
        "This document's file is not available. It may have been recorded before uploads were configured — re-upload it, or ask an administrator to refresh the link.",
      );
    }

    return new Response(null, {
      status: 302,
      headers: {
        location: fileUrl,
        // The signed URL is specific to this user's request — do not cache it.
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
