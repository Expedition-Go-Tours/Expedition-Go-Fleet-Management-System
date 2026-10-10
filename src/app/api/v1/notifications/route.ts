import { NextRequest } from "next/server";

import { jsonOk, toErrorResponse } from "@/lib/api/errors";
import { requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listNotifications } from "@/lib/repos/notifications";

export const runtime = "nodejs";

/**
 * GET /api/v1/notifications
 * In-app notifications for the caller's roles (notification:read).
 * Merged across every role the user holds. Query: ?unreadOnly=true&limit=
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.NOTIFICATION_READ);

    const params = request.nextUrl.searchParams;
    const limitRaw = Number(params.get("limit"));
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;

    const merged = new Map<string, Awaited<ReturnType<typeof listNotifications>>[number]>();
    for (const role of context.user.roles) {
      const list = await listNotifications({ recipientRole: role, limit: 500 });
      for (const n of list) merged.set(n.id, n);
    }
    let notifications = [...merged.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    if (params.get("unreadOnly") === "true") {
      notifications = notifications.filter((n) => !n.readAt);
    }
    notifications = notifications.slice(0, limit);

    return jsonOk({
      notifications,
      unreadCount: [...merged.values()].filter((n) => !n.readAt).length,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
