import type { DocumentData } from "firebase-admin/firestore";

import type { SessionRecord } from "@/lib/auth/types";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";

/** Firestore-backed session registry. Document id is the peppered token hash. */

function sessionsRef() {
  return getAdminDb().collection(COLLECTIONS.sessions);
}

function toDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate();
  }
  return undefined;
}

function toSessionRecord(tokenHash: string, data: DocumentData): SessionRecord {
  return {
    tokenHash,
    userId: String(data.userId),
    createdAt: toDate(data.createdAt) ?? new Date(0),
    lastSeenAt: toDate(data.lastSeenAt) ?? new Date(0),
    idleExpiresAt: toDate(data.idleExpiresAt) ?? new Date(0),
    expiresAt: toDate(data.expiresAt) ?? new Date(0),
    mfaSatisfied: Boolean(data.mfaSatisfied),
    mustChangePassword: Boolean(data.mustChangePassword),
    userAgentLabel: data.userAgentLabel ? String(data.userAgentLabel) : undefined,
    revokedAt: toDate(data.revokedAt),
    revokeReason: data.revokeReason ? String(data.revokeReason) : undefined,
  };
}

export async function createSession(record: SessionRecord): Promise<void> {
  const { tokenHash, ...rest } = record;
  await sessionsRef().doc(tokenHash).set(rest);
}

export async function getSession(tokenHash: string): Promise<SessionRecord | null> {
  const snap = await sessionsRef().doc(tokenHash).get();
  if (!snap.exists) return null;
  return toSessionRecord(snap.id, snap.data() ?? {});
}

export async function touchSession(
  tokenHash: string,
  lastSeenAt: Date,
  idleExpiresAt: Date,
): Promise<void> {
  await sessionsRef().doc(tokenHash).update({ lastSeenAt, idleExpiresAt });
}

export async function revokeSession(tokenHash: string, reason: string): Promise<void> {
  const { FieldValue } = await import("firebase-admin/firestore");
  await sessionsRef().doc(tokenHash).set(
    {
      revokedAt: FieldValue.serverTimestamp(),
      revokeReason: reason,
    },
    { merge: true },
  );
}

/** Revoke every not-yet-revoked session for a user. Returns the number revoked. */
export async function revokeSessionsForUser(userId: string, reason: string): Promise<number> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const snap = await sessionsRef().where("userId", "==", userId).get();
  const active = snap.docs.filter((doc) => !doc.data().revokedAt);
  await Promise.all(
    active.map((doc) =>
      doc.ref.set(
        { revokedAt: FieldValue.serverTimestamp(), revokeReason: reason },
        { merge: true },
      ),
    ),
  );
  return active.length;
}
