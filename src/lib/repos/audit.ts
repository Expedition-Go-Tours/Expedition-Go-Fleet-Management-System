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
  USER_UPDATED: "user.updated",
  USER_ROLE_ASSIGNED: "user.role.assigned",
  USER_STATUS_CHANGED: "user.status.changed",
  PASSWORD_CHANGED: "user.password.changed",
  AUTHORIZATION_DENIED: "authz.denied",
  VEHICLE_CREATED: "vehicle.created",
  VEHICLE_UPDATED: "vehicle.updated",
  VEHICLE_STATUS_CHANGED: "vehicle.status.changed",
  REPORT_CREATED: "report.created",
  REPORT_STATUS_CHANGED: "report.status.changed",
  WORK_ORDER_CREATED: "work_order.created",
  WORK_ORDER_UPDATED: "work_order.updated",
  WORK_ORDER_STATUS_CHANGED: "work_order.status.changed",
  EXPENSE_CREATED: "expense.created",
  EXPENSE_STATUS_CHANGED: "expense.status.changed",
  PROVIDER_CREATED: "provider.created",
  PROVIDER_UPDATED: "provider.updated",
  ODOMETER_RECORDED: "odometer.recorded",
  ODOMETER_CORRECTED: "odometer.corrected",
  SCHEDULE_CREATED: "schedule.created",
  SCHEDULE_UPDATED: "schedule.updated",
  SERVICE_RECORDED: "service.recorded",
  WORK_ORDER_WAITED: "work_order.waited",
  WORK_ORDER_VERIFIED: "work_order.verified",
  ISSUE_TRIAGED: "issue.triaged",
  ISSUE_CLOSED: "issue.closed",
  ISSUE_RECLASSIFIED: "issue.reclassified",
  SAFETY_HOLD_APPLIED: "safety_hold.applied",
  SAFETY_HOLD_RELEASED: "safety_hold.released",
  INCIDENT_CREATED: "incident.created",
  INCIDENT_UPDATED: "incident.updated",
  ASSIGNMENT_CREATED: "assignment.created",
  ASSIGNMENT_STARTED: "assignment.started",
  ASSIGNMENT_ENDED: "assignment.ended",
  INSPECTION_SUBMITTED: "inspection.submitted",
  DOCUMENT_UPLOADED: "document.uploaded",
  DOCUMENT_UPDATED: "document.updated",
  FUEL_RECORDED: "fuel.recorded",
  AUDIT_READ: "audit.read",
  EXPORT_GENERATED: "export.generated",
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
