import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { parseProviderBody } from "@/lib/api/validate";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { createProvider, listProviders } from "@/lib/repos/providers";

export const runtime = "nodejs";

/**
 * GET /api/v1/providers
 * List service providers. Requires provider:read.
 * Query: ?activeOnly=true
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.PROVIDER_READ);

    const activeOnly = request.nextUrl.searchParams.get("activeOnly") === "true";
    const providers = await listProviders({ activeOnly });
    return jsonOk({ providers });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/providers
 * Register a service provider. Requires provider:create (ADMIN baseline).
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.PROVIDER_CREATE);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const input = parseProviderBody(body);
    const provider = await createProvider(input);

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.PROVIDER_CREATED,
      actorId: context.user.id,
      entityType: "provider",
      entityId: provider.id,
      after: { name: provider.name },
      requestId,
    });

    return jsonOk({ provider }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
