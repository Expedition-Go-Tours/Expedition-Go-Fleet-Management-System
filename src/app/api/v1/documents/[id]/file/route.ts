import { NextRequest } from "next/server";

import { ApiError, toErrorResponse } from "@/lib/api/errors";
import { requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getDocumentById } from "@/lib/repos/documents";

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
    if (!document.fileUrl) {
      throw ApiError.notFound(
        "This document has no file attached. It may have been recorded before file uploads were configured.",
      );
    }

    return new Response(null, {
      status: 302,
      headers: {
        location: document.fileUrl,
        // The signed URL is short-lived and specific to this user's request.
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
