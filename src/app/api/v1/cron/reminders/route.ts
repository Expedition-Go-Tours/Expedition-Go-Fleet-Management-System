import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { serverEnv } from "@/lib/env";
import { computeScheduleStatus } from "@/lib/domain/maintenance";
import { deriveDocumentReminders, deriveScheduleReminders } from "@/lib/domain/reminders";
import { listAllSchedules } from "@/lib/repos/maintenance";
import { listDocumentsExpiringSoon } from "@/lib/repos/documents";
import { createNotification } from "@/lib/repos/notifications";
import { listVehicles } from "@/lib/repos/vehicles";

export const runtime = "nodejs";

/**
 * POST /api/v1/cron/reminders
 * Vercel Cron maintenance-reminder sweep.
 *
 * Protected by CRON_SECRET (bearer token). The sweep reads LIVE data —
 * schedules recomputed from current odometer + date, documents from their
 * expiry dates — and writes notifications idempotently: every notification
 * carries a dedupe key, so a retry or overlapping run produces no
 * duplicates. The sweep is safe to re-run at any time.
 *
 * Reminder statuses are never the source of truth — vehicle pages always
 * compute status live; this job only creates the actionable nudges.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${serverEnv.cronSecret}`) {
      throw ApiError.unauthorized("Invalid cron secret");
    }

    const now = new Date();
    const vehicles = await listVehicles({ limit: 500 });
    const byId = new Map(vehicles.map((v) => [v.id, v]));
    const schedules = await listAllSchedules(2000);

    let created = 0;
    let skipped = 0;

    for (const schedule of schedules) {
      if (!schedule.enabled) continue;
      const vehicle = byId.get(schedule.vehicleId);
      if (!vehicle || vehicle.status === "ARCHIVED") continue;

      const computed = computeScheduleStatus({
        intervalKm: schedule.intervalKm,
        intervalDays: schedule.intervalDays,
        dueSoonKm: schedule.dueSoonKm,
        dueSoonDays: schedule.dueSoonDays,
        lastServiceOdometerKm: schedule.lastServiceOdometerKm,
        lastServiceDate: schedule.lastServiceDate,
        currentOdometerKm: vehicle.odometerKm,
        now,
      });
      if (!computed.computed) continue; // NOT_CONFIGURED — nothing to remind

      const candidates = deriveScheduleReminders({
        vehicleId: vehicle.id,
        regNumber: vehicle.regNumber,
        scheduleId: schedule.id,
        taskName: schedule.taskName,
        status: computed.status,
        nextDueOdometerKm: computed.nextDueOdometerKm,
        nextDueDate: computed.nextDueDate,
        remainingKm: computed.remainingKm,
        remainingDays: computed.remainingDays,
        now,
      });

      for (const role of ["MAINTENANCE", "OPERATIONS"]) {
        for (const candidate of candidates) {
          const result = await createNotification({
            recipientRole: role,
            type: candidate.type,
            title: candidate.title,
            body: candidate.body,
            linkUrl: candidate.linkUrl,
            entityType: "maintenanceSchedule",
            entityId: candidate.entityId,
            dedupeKey: `${role}:${candidate.dedupeKey}`,
          });
          if (result.created) created += 1;
          else skipped += 1;
        }
      }
    }

    // Document expiry reminders (warning window from env, default 30 days).
    const warningDays = Number(process.env.DOCUMENT_EXPIRY_WARNING_DAYS ?? 30);
    const expiring = await listDocumentsExpiringSoon(now, warningDays, 1000);
    for (const { document } of expiring) {
      const vehicle = byId.get(document.vehicleId);
      if (!vehicle) continue;
      const candidates = deriveDocumentReminders({
        vehicleId: vehicle.id,
        regNumber: vehicle.regNumber,
        documentId: document.id,
        category: String(document.category),
        expiryDate: document.expiryDate,
        now,
        warningDays,
      });
      for (const role of ["OPERATIONS", "MAINTENANCE"]) {
        for (const candidate of candidates) {
          const result = await createNotification({
            recipientRole: role,
            type: candidate.type,
            title: candidate.title,
            body: candidate.body,
            linkUrl: candidate.linkUrl,
            entityType: "vehicleDocument",
            entityId: candidate.entityId,
            dedupeKey: `${role}:${candidate.dedupeKey}`,
          });
          if (result.created) created += 1;
          else skipped += 1;
        }
      }
    }

    return jsonOk({
      ok: true,
      vehiclesScanned: vehicles.length,
      schedulesScanned: schedules.length,
      documentsScanned: expiring.length,
      notificationsCreated: created,
      duplicatesSkipped: skipped,
      ranAt: now.toISOString(),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
