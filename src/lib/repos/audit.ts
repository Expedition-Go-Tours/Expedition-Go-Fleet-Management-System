import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";

/*
 * Append-only audit log. Security events and business audit share this sink but
 * keep distinct `eventType` values.
 *
 * Never pass secrets here: no passwords, ID tokens, cookies, session tokens,
 * MFA codes, invite/reset links, or signed document URLs.
 */

export const AUDIT_EVENTS = {
  SIGN_IN_SUCCEEDED: "auth.sign_in.succeeded",
  SIGN_IN_FAILED: "auth.sign_in.failed",
  SESSION_CREATED: "auth.session.created",
  SESSION_REVOKED: "auth.session.revoked",
  LOGOUT: "auth.logout",
  INVITE_CREATED: "user.invite.created",
  INVITE_ACCEPTED: "user.invite.accepted",
  USER_ROLE_ASSIGNED: "user.role.assigned",
  USER_STATUS_CHANGED: "user.status.changed",
  AUTHORIZATION_DENIED: "authz.denied",
} as const;

export type AuditEventType = (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS];

export interface AuditEventInput {
  eventType: AuditEventType;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  requestId?: string;
  outcome?: "SUCCESS" | "FAILURE";
}

/** Trim/whitelist untrusted strings to reduce log-injection risk. */
function sanitize(value: string | undefined): string | undefined {
  return value?.replace(/[\r\n]+/g, " ").slice(0, 500);
}

export async function writeAuditEvent(event: AuditEventInput): Promise<void> {
  const { FieldValue } = await import("firebase-admin/firestore");
  try {
    await getAdminDb()
      .collection(COLLECTIONS.auditLogs)
      .add({
        eventType: event.eventType,
        actorId: event.actorId ?? null,
        entityType: sanitize(event.entityType) ?? null,
        entityId: sanitize(event.entityId) ?? null,
        before: event.before ?? null,
        after: event.after ?? null,
        reason: sanitize(event.reason) ?? null,
        requestId: sanitize(event.requestId) ?? null,
        outcome: event.outcome ?? "SUCCESS",
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch (error) {
    // An audit-write outage must not take down the request path, but it must be
    // visible to operators.
    console.error("[audit] failed to write event", event.eventType, error);
  }
}
