import { computeScheduleStatus } from "@/lib/domain/maintenance";
import { documentState } from "@/lib/domain/document";

/*
 * Reminder generation (Phase F).
 *
 * Generates actionable in-app notifications from LIVE data: schedules are
 * recomputed from the current odometer + date, documents are evaluated
 * against their expiry dates. Idempotency comes from notification dedupe
 * keys of the form `<type>:<entity>:<period>` where period buckets by the
 * occurrence (day for date reminders, due-km band for odometer reminders),
 * so cron retries and overlapping runs never duplicate.
 */

export const REMINDER_ROLES = ["MAINTENANCE", "OPERATIONS"] as const;

/** Bucket a km-threshold reminder so it fires once per 250 km band. */
export function kmBand(dueOdometerKm: number, remainingKm: number): string {
  const band = Math.floor(remainingKm / 250);
  return `${dueOdometerKm}:${band}`;
}

/** Day bucket for date-based reminders. */
export function dayBucket(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export interface ReminderCandidate {
  type:
    | "MAINTENANCE_DUE_SOON_KM"
    | "MAINTENANCE_DUE_SOON_DATE"
    | "MAINTENANCE_DUE"
    | "MAINTENANCE_OVERDUE"
    | "DOCUMENT_EXPIRING"
    | "DOCUMENT_EXPIRED";
  title: string;
  body: string;
  linkUrl: string;
  entityId: string;
  dedupeKey: string;
}

/**
 * Pure: derive reminder candidates from evaluated schedules. Each candidate
 * carries a dedupe key; the repo's createNotification is idempotent on it.
 */
export function deriveScheduleReminders(input: {
  vehicleId: string;
  regNumber: string;
  scheduleId: string;
  taskName: string;
  status: string;
  nextDueOdometerKm: number | null;
  nextDueDate: Date | null;
  remainingKm: number | null;
  remainingDays: number | null;
  now: Date;
}): ReminderCandidate[] {
  const link = `/vehicles/${input.vehicleId}`;
  const base = `vehicle:${input.vehicleId}:schedule:${input.scheduleId}`;
  const candidates: ReminderCandidate[] = [];

  if (input.status === "OVERDUE") {
    candidates.push({
      type: "MAINTENANCE_OVERDUE",
      title: `OVERDUE: ${input.taskName} (${input.regNumber})`,
      body:
        input.remainingKm !== null && input.remainingKm < 0
          ? `${Math.abs(input.remainingKm)} km past due`
          : `Past due since ${input.nextDueDate?.toISOString().slice(0, 10) ?? "—"}`,
      linkUrl: link,
      entityId: input.scheduleId,
      dedupeKey: `${base}:OVERDUE:${dayBucket(input.now)}`,
    });
    return candidates; // overdue alone; do not also spam due/soon
  }
  if (input.status === "DUE") {
    candidates.push({
      type: "MAINTENANCE_DUE",
      title: `DUE NOW: ${input.taskName} (${input.regNumber})`,
      body:
        input.nextDueOdometerKm !== null
          ? `Due at ${input.nextDueOdometerKm.toLocaleString()} km`
          : `Due ${input.nextDueDate?.toISOString().slice(0, 10) ?? ""}`,
      linkUrl: link,
      entityId: input.scheduleId,
      dedupeKey: `${base}:DUE:${dayBucket(input.now)}`,
    });
    return candidates;
  }
  if (input.status === "DUE_SOON") {
    if (input.remainingKm !== null && input.nextDueOdometerKm !== null) {
      candidates.push({
        type: "MAINTENANCE_DUE_SOON_KM",
        title: `Due soon: ${input.taskName} (${input.regNumber})`,
        body: `${input.remainingKm.toLocaleString()} km until due (${input.nextDueOdometerKm.toLocaleString()} km)`,
        linkUrl: link,
        entityId: input.scheduleId,
        dedupeKey: `${base}:SOON_KM:${kmBand(input.nextDueOdometerKm, input.remainingKm)}`,
      });
    }
    if (input.remainingDays !== null && input.nextDueDate) {
      candidates.push({
        type: "MAINTENANCE_DUE_SOON_DATE",
        title: `Due soon: ${input.taskName} (${input.regNumber})`,
        body: `${input.remainingDays} day(s) until ${input.nextDueDate.toISOString().slice(0, 10)}`,
        linkUrl: link,
        entityId: input.scheduleId,
        dedupeKey: `${base}:SOON_DATE:${dayBucket(input.nextDueDate)}`,
      });
    }
  }
  return candidates;
}

/** Pure: document expiry reminder candidates. */
export function deriveDocumentReminders(input: {
  vehicleId: string;
  regNumber: string;
  documentId: string;
  category: string;
  expiryDate: string | undefined;
  now: Date;
  warningDays: number;
}): ReminderCandidate[] {
  const doc = { expiryDate: input.expiryDate };
  const state = documentState(doc, input.now, input.warningDays);
  const link = `/vehicles/${input.vehicleId}`;
  const base = `vehicle:${input.vehicleId}:document:${input.documentId}`;

  if (state === "EXPIRED") {
    return [
      {
        type: "DOCUMENT_EXPIRED",
        title: `EXPIRED document: ${input.category} (${input.regNumber})`,
        body: `Expired ${input.expiryDate}`,
        linkUrl: link,
        entityId: input.documentId,
        dedupeKey: `${base}:EXPIRED:${dayBucket(input.now)}`,
      },
    ];
  }
  if (state === "EXPIRING_SOON") {
    return [
      {
        type: "DOCUMENT_EXPIRING",
        title: `Document expiring: ${input.category} (${input.regNumber})`,
        body: `Expires ${input.expiryDate} — renew before expiry`,
        linkUrl: link,
        entityId: input.documentId,
        dedupeKey: `${base}:SOON:${input.expiryDate}`,
      },
    ];
  }
  return [];
}

export { computeScheduleStatus };
