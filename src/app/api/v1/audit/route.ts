import { randomUUID } from "node:crypto";

import type { DocumentData } from "firebase-admin/firestore";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { toDate } from "@/lib/repos/timestamps";

export const runtime = "nodejs";

interface AuditLogEntry {
  id: string;
  eventType: string;
  actorId: string | null;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  requestId: string | null;
  outcome: string;
  createdAt: Date;
}

function toAuditEntry(id: string, data: DocumentData): AuditLogEntry {
  return {
    id,
    eventType: String(data.eventType ?? ""),
    actorId: data.actorId ? String(data.actorId) : null,
    entityType: data.entityType ? String(data.entityType) : null,
    entityId: data.entityId ? String(data.entityId) : null,
    before: data.before ?? null,
    after: data.after ?? null,
    reason: data.reason ? String(data.reason) : null,
    requestId: data.requestId ? String(data.requestId) : null,
    outcome: String(data.outcome ?? "SUCCESS"),
    createdAt: toDate(data.createdAt) ?? new Date(0),
  };
}

/**
 * GET /api/v1/audit
 * Read the audit trail. Requires audit:read.
 * The read itself is audited (spec §10: views are recorded).
 *
 * Query: ?eventType=&entityType=&entityId=&actorId=&outcome=&limit= (max 500)
 * Note: filtered queries sort in memory to avoid composite-index setup at MVP;
 * the collection is append-only and small enough for this to stay cheap.
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.AUDIT_READ);

    const params = request.nextUrl.searchParams;
    const limitRaw = Number(params.get("limit"));
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 500 ? limitRaw : 100;

    const eventType = params.get("eventType");
    const entityType = params.get("entityType");
    const entityId = params.get("entityId");
    const actorId = params.get("actorId");
    const outcome = params.get("outcome");

    if (outcome && !["SUCCESS", "FAILURE"].includes(outcome)) {
      throw ApiError.badRequest("outcome must be SUCCESS or FAILURE");
    }

    let query = getAdminDb()
      .collection(COLLECTIONS.auditLogs)
      .limit(Math.min(limit * 4, 2000));
    if (eventType) query = query.where("eventType", "==", eventType);
    if (entityType) query = query.where("entityType", "==", entityType);
    if (entityId) query = query.where("entityId", "==", entityId);
    if (actorId) query = query.where("actorId", "==", actorId);
    if (outcome) query = query.where("outcome", "==", outcome);

    const snap = await query.get();
    const entries = snap.docs
      .map((doc) => toAuditEntry(doc.id, doc.data()))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);

    // Audit the read itself — spec §10 requires recording log views.
    await writeAuditEvent({
      eventType: AUDIT_EVENTS.AUDIT_READ,
      actorId: context.user.id,
      reason: `limit=${limit}${eventType ? ` eventType=${eventType}` : ""}${
        entityId ? ` entityId=${entityId}` : ""
      }`,
      requestId,
    });

    return jsonOk({ entries, count: entries.length });
  } catch (error) {
    return toErrorResponse(error);
  }
}
