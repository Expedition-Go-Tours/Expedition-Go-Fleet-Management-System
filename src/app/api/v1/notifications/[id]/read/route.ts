import { NextRequest } from "next/server";

import { jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { markNotificationRead } from "@/lib/repos/notifications";

export const runtime = "nodejs";

/**
 * POST /api/v1/notifications/[id]/read
 * Mark a notification read.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.NOTIFICATION_READ);

    const { id } = await params;
    await markNotificationRead(id);
    return jsonOk({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
