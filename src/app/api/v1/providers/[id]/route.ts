import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { parseProviderBody } from "@/lib/api/validate";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { getProviderById, updateProvider } from "@/lib/repos/providers";

export const runtime = "nodejs";

/**
 * GET /api/v1/providers/[id]
 * Read one provider. Requires provider:read.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.PROVIDER_READ);

    const { id } = await params;
    const provider = await getProviderById(id);
    if (!provider) throw ApiError.notFound("Provider not found");
    return jsonOk({ provider });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * PATCH /api/v1/providers/[id]
 * Update provider details, including deactivation (`active: false`).
 * Requires provider:update. Deactivated providers stay in history.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.PROVIDER_UPDATE);

    const { id } = await params;
    const provider = await getProviderById(id);
    if (!provider) throw ApiError.notFound("Provider not found");

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    // Shared field validation — reuses the same parser as create.
    const parsed = parseProviderBody({ ...provider, ...body });
    const fields: Parameters<typeof updateProvider>[1] = {
      name: parsed.name,
      phone: parsed.phone,
      contactName: parsed.contactName,
      email: parsed.email,
      address: parsed.address,
      specialties: parsed.specialties,
    };
    if (body.active !== undefined) {
      if (typeof body.active !== "boolean") throw ApiError.badRequest("active must be a boolean");
      fields.active = body.active;
    }

    const updated = await updateProvider(id, fields);

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.PROVIDER_UPDATED,
      actorId: context.user.id,
      entityType: "provider",
      entityId: id,
      before: { name: provider.name, active: provider.active },
      after: { name: updated.name, active: updated.active },
      requestId,
    });

    return jsonOk({ provider: updated });
  } catch (error) {
    return toErrorResponse(error);
  }
}
