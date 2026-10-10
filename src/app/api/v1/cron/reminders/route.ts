import { NextRequest } from "next/server";

import { isValidCronBearer, readCronSecret } from "@/lib/api/cron";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { computeScheduleStatus } from "@/lib/domain/maintenance";
import { deriveDocumentReminders, deriveScheduleReminders } from "@/lib/domain/reminders";
import { listAllSchedules } from "@/lib/repos/maintenance";
import { reconcileAssignmentReservations } from "@/lib/repos/assignments";
import { listDocumentsExpiringSoon } from "@/lib/repos/documents";
import { createNotification } from "@/lib/repos/notifications";
import { listVehicles } from "@/lib/repos/vehicles";

export const runtime = "nodejs";

/**
 * GET /api/v1/cron/reminders — Vercel Cron invocation (Vercel Cron sends GET).
 * POST /api/v1/cron/reminders — deliberate internal/manual invocation.
 *
 * Both methods run the identical handler and are gated by the identical
 * `Authorization: Bearer <CRON_SECRET>` check (constant-time), so supporting a
 * manual POST does not weaken the scheduled endpoint: neither method can run
 * the sweep without the shared secret.
 *
 * The sweep reads LIVE data — schedules recomputed from current odometer +
 * date, documents from their expiry dates — and writes notifications
 * idempotently: every notification carries a dedupe key, so a Vercel retry, a
 * duplicate request or two overlapping invocations produce no duplicates. The
 * sweep is safe to re-run at any time.
 *
 * Reminder statuses are never the source of truth — vehicle pages always
 * compute status live; this job only creates the actionable nudges.
 */
async function runReminders(request: NextRequest) {
  try {
    const secret = readCronSecret();
    // Fail closed: if CRON_SECRET is unset the sweep must not run at all, and
    // the response must not reveal whether a secret exists.
    if (!secret) {
      throw ApiError.unauthorized("Invalid cron secret");
    }
    if (!isValidCronBearer(request.headers.get("authorization"), secret)) {
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

    // Repair assignment reservations (clear stale, backfill legacy) so the
    // vehicle/driver concurrency invariant holds even for pre-existing data.
    // Isolated so a reconciliation failure cannot suppress reminders.
    let reconciliation: { released: number; backfilled: number } | { error: string };
    try {
      reconciliation = await reconcileAssignmentReservations(500);
    } catch (error) {
      reconciliation = { error: error instanceof Error ? error.message : "unknown error" };
    }

    // Outcome only — no secret, token or user data — so a failed or partial
    // sweep is detectable and recoverable from the function logs.
    console.log(
      `[cron/reminders] vehicles=${vehicles.length} schedules=${schedules.length} documents=${expiring.length} created=${created} skipped=${skipped} reconciliation=${JSON.stringify(reconciliation)}`,
    );

    return jsonOk({
      ok: true,
      vehiclesScanned: vehicles.length,
      schedulesScanned: schedules.length,
      documentsScanned: expiring.length,
      notificationsCreated: created,
      duplicatesSkipped: skipped,
      reservations: reconciliation,
      ranAt: now.toISOString(),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Vercel Cron invokes scheduled paths with GET. */
export async function GET(request: NextRequest) {
  return runReminders(request);
}

/** Internal/manual invocation, same secret gate as GET. */
export async function POST(request: NextRequest) {
  return runReminders(request);
}
