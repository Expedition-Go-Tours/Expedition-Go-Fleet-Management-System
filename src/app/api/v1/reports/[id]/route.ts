import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext } from "@/lib/auth/guards";
import { PERMISSIONS, rolesHavePermission } from "@/lib/auth/permissions";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { addIssueFollowUp, getIssueById } from "@/lib/repos/reports";

export const runtime = "nodejs";

/**
 * GET /api/v1/reports/[id]
 * Read one vehicle issue. Ownership-aware: report:read:own can read their own;
 * report:read:all reads any.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAuthContext();
    const { id } = await params;
    const issue = await getIssueById(id);
    if (!issue) throw ApiError.notFound("Issue not found");

    const canReadAll = rolesHavePermission(context.user.roles, PERMISSIONS.REPORT_READ_ALL);
    const isOwner = issue.reportedBy === context.user.id;
    if (
      !canReadAll &&
      !(isOwner && rolesHavePermission(context.user.roles, PERMISSIONS.REPORT_READ_OWN))
    ) {
      throw ApiError.forbidden("You do not have permission to read this issue");
    }
    return jsonOk({ report: issue });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/reports/[id]/follow-up
 * The reporter or permitted staff add a follow-up comment/evidence. The
 * original report content is never modified.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    const canReadAll = rolesHavePermission(context.user.roles, PERMISSIONS.REPORT_READ_ALL);

    const { id } = await params;
    const issue = await getIssueById(id);
    if (!issue) throw ApiError.notFound("Issue not found");

    const isOwner = issue.reportedBy === context.user.id;
    if (!canReadAll && !isOwner) {
      throw ApiError.forbidden("Only the reporter or staff can add follow-ups");
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 2000) {
      throw ApiError.badRequest("Follow-up text is required (max 2000 chars)");
    }

    const updated = await addIssueFollowUp(id, {
      byUserId: context.user.id,
      text,
      evidenceKeys: Array.isArray(body?.evidenceKeys)
        ? (body!.evidenceKeys as unknown[])
            .filter((k): k is string => typeof k === "string")
            .slice(0, 10)
        : [],
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.REPORT_STATUS_CHANGED,
      actorId: context.user.id,
      entityType: "issue",
      entityId: id,
      reason: "follow-up added",
      requestId,
    });

    return jsonOk({ report: updated });
  } catch (error) {
    return toErrorResponse(error);
  }
}
