import { NextRequest, NextResponse } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { SAVED_LOCATION_CATEGORIES, type SavedLocationCategory } from "@/lib/domain/saved-location";
import {
  SavedLocationError,
  createSavedLocation,
  listSavedLocations,
} from "@/lib/repos/saved-locations";

export const runtime = "nodejs";

/**
 * GET /api/v1/saved-locations
 * List saved company locations. Requires trip:read.
 * Query: ?category=&active=true|false
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.TRIP_READ);

    const params = request.nextUrl.searchParams;
    const categoryParam = params.get("category") ?? undefined;
    if (
      categoryParam &&
      !(SAVED_LOCATION_CATEGORIES as readonly string[]).includes(categoryParam)
    ) {
      throw ApiError.badRequest(`category must be one of: ${SAVED_LOCATION_CATEGORIES.join(", ")}`);
    }
    const activeParam = params.get("active");
    const active = activeParam === "true" ? true : activeParam === "false" ? false : undefined;

    const locations = await listSavedLocations({
      category: categoryParam as SavedLocationCategory | undefined,
      active,
    });
    return jsonOk({ locations });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/saved-locations
 * Create a saved company location. Requires trip:create.
 */
export async function POST(request: NextRequest) {
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.TRIP_CREATE);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const label = typeof body.label === "string" ? body.label.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";

    if (!label) throw ApiError.badRequest("label is required");
    if (!category || !(SAVED_LOCATION_CATEGORIES as readonly string[]).includes(category)) {
      throw ApiError.badRequest(`category must be one of: ${SAVED_LOCATION_CATEGORIES.join(", ")}`);
    }

    const location = await createSavedLocation({
      label,
      category: category as SavedLocationCategory,
      address: typeof body.address === "string" ? body.address.trim() : undefined,
      latitude: typeof body.latitude === "number" ? body.latitude : undefined,
      longitude: typeof body.longitude === "number" ? body.longitude : undefined,
      placeId: typeof body.placeId === "string" ? body.placeId : undefined,
      notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) : undefined,
      createdBy: context.user.id,
    });

    return jsonOk({ location }, { status: 201 });
  } catch (error) {
    if (error instanceof SavedLocationError) {
      const status = error.code === "NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
    }
    return toErrorResponse(error);
  }
}
