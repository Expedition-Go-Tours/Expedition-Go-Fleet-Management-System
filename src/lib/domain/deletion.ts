import { DomainError } from "@/lib/domain/errors";
import type { AuditEventType } from "@/lib/repos/audit";

/**
 * Hard-delete support for the three record types an ADMIN may remove.
 *
 * A deletion is permanent, so every route requires a written reason and writes
 * a full before/after audit event. Linked records are cleaned up in the same
 * transaction: a fuel purchase or service record removes its canonical expense,
 * an expense clears its source link, and a deleted service record clears the
 * schedule baselines it last set rather than leaving a false due point.
 */

export class DeletionError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "DeletionError";
  }
}

export const MAX_DELETE_REASON_LENGTH = 500;

/**
 * Audit context supplied by the route. The repository writes this event inside
 * the same Firestore transaction as the delete, so a successful deletion can
 * never exist without its before-snapshot.
 */
export interface DeletionAudit {
  eventType: AuditEventType;
  actorId: string;
  entityType: string;
  entityId: string;
  reason: string;
  requestId: string;
}

/** A written reason is mandatory: it is the only trace left after a hard delete. */
export function parseDeletionReason(value: unknown): string {
  if (typeof value !== "string") {
    throw new DeletionError("INVALID_INPUT_REASON", "A reason is required to delete a record");
  }
  const reason = value.trim();
  if (reason.length < 3) {
    throw new DeletionError(
      "INVALID_INPUT_REASON",
      "Give a short reason (at least 3 characters) for deleting this record",
    );
  }
  if (reason.length > MAX_DELETE_REASON_LENGTH) {
    throw new DeletionError(
      "INVALID_INPUT_REASON",
      `The deletion reason must be ${MAX_DELETE_REASON_LENGTH} characters or fewer`,
    );
  }
  return reason;
}

/**
 * Audit documents cannot contain `undefined`. JSON round-tripping also turns
 * Dates into ISO strings, which keeps the before/after snapshot readable.
 */
export function auditSnapshot(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
