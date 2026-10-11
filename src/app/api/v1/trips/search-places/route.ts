import { NextRequest } from "next/server";

import { jsonOk, toErrorResponse, ApiError } from "@/lib/api/errors";
import { requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { searchPlaces } from "@/lib/routing/photon";

export const runtime = "nodejs";

/**
 * GET /api/v1/trips/search-places?q=...&lat=...&lng=...
 * Server-side geocoding via Photon (OpenStreetMap).
 * Requires trip:read permission (any authenticated driver or operations user).
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.TRIP_READ);

    const q = request.nextUrl.searchParams.get("q")?.trim();
    if (!q || q.length < 2) {
      throw ApiError.badRequest("Query must be at least 2 characters");
    }
    if (q.length > 200) {
      throw ApiError.badRequest("Query is too long");
    }

    const latStr = request.nextUrl.searchParams.get("lat");
    const lngStr = request.nextUrl.searchParams.get("lng");
    const lat = latStr ? Number(latStr) : undefined;
    const lng = lngStr ? Number(lngStr) : undefined;

    const results = await searchPlaces(q, lat, lng);
    return jsonOk({ places: results });
  } catch (error) {
    return toErrorResponse(error);
  }
}
