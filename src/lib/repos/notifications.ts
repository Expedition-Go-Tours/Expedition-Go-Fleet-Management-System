import type { DocumentData } from "firebase-admin/firestore";

import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import { toDate } from "@/lib/repos/timestamps";

/*
 * In-app notifications.
 *
 * Idempotency is enforced by `dedupeKey`: the same reminder occurrence
 * (vehicle + schedule + threshold + period) is written exactly once, so a
 * cron retry or overlapping run never duplicates a notification.
 */

export const NOTIFICATION_TYPES = [
  "MAINTENANCE_DUE_SOON_KM",
  "MAINTENANCE_DUE_SOON_DATE",
  "MAINTENANCE_DUE",
  "MAINTENANCE_OVERDUE",
  "SAFETY_HOLD_APPLIED",
  "CRITICAL_ISSUE",
  "DOCUMENT_EXPIRING",
  "DOCUMENT_EXPIRED",
  "WORK_ORDER_OVERDUE",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface Notification {
  id: string;
  recipientRole: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Deep link to the relevant vehicle/report/task/work order. */
  linkUrl: string;
  entityType: string;
  entityId: string;
  dedupeKey: string;
  readAt?: Date;
  createdAt: Date;
}

function notificationsRef() {
  return getAdminDb().collection(COLLECTIONS.notifications);
}

function toNotification(id: string, data: DocumentData): Notification {
  return {
    id,
    recipientRole: String(data.recipientRole ?? "OPERATIONS"),
    type: (data.type ?? "MAINTENANCE_DUE") as NotificationType,
    title: String(data.title ?? ""),
    body: String(data.body ?? ""),
    linkUrl: String(data.linkUrl ?? "/"),
    entityType: String(data.entityType ?? ""),
    entityId: String(data.entityId ?? ""),
    dedupeKey: String(data.dedupeKey ?? ""),
    readAt: toDate(data.readAt),
    createdAt: toDate(data.createdAt) ?? new Date(0),
  };
}

/**
 * Create a notification if its dedupeKey has not been used. Returns
 * `created: false` when the notification already exists (idempotent).
 * A transaction reads the dedupe doc before writing, so concurrent cron
 * runs cannot double-insert.
 */
export async function createNotification(input: {
  recipientRole: string;
  type: NotificationType;
  title: string;
  body: string;
  linkUrl: string;
  entityType: string;
  entityId: string;
  dedupeKey: string;
}): Promise<{ notification: Notification; created: boolean }> {
  const db = getAdminDb();
  // The dedupe document id IS the key — deterministic and indexed.
  const dedupeId = input.dedupeKey.replace(/[^\w:.-]/g, "_").slice(0, 500);
  const docRef = notificationsRef().doc(dedupeId);

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(docRef);
    if (existing.exists) {
      return { notification: toNotification(existing.id, existing.data() ?? {}), created: false };
    }
    const notification: Notification = {
      id: dedupeId,
      recipientRole: input.recipientRole,
      type: input.type,
      title: input.title.slice(0, 200),
      body: input.body.slice(0, 1000),
      linkUrl: input.linkUrl,
      entityType: input.entityType,
      entityId: input.entityId,
      dedupeKey: input.dedupeKey,
      createdAt: new Date(),
    };
    tx.set(docRef, { ...notification });
    return { notification, created: true };
  });
}

/** Latest notifications, optionally filtered by role. */
export async function listNotifications(options?: {
  recipientRole?: string;
  unreadOnly?: boolean;
  limit?: number;
}): Promise<Notification[]> {
  let query: import("firebase-admin/firestore").Query = notificationsRef();
  if (options?.recipientRole) {
    query = query.where("recipientRole", "==", options.recipientRole);
  }
  const snap = await query.limit(2000).get();
  return snap.docs
    .map((d) => toNotification(d.id, d.data()))
    .filter((n) => (options?.unreadOnly ? !n.readAt : true))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, options?.limit ?? 50);
}

export async function markNotificationRead(id: string): Promise<void> {
  const { FieldValue } = await import("firebase-admin/firestore");
  await notificationsRef().doc(id).update({ readAt: FieldValue.serverTimestamp() });
}
