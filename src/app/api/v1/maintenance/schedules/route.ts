import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { computeScheduleStatus } from "@/lib/domain/maintenance";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { createSchedule, listSchedules } from "@/lib/repos/maintenance";
import { getVehicleById } from "@/lib/repos/vehicles";

export const runtime = "nodejs";

/**
 * GET /api/v1/maintenance/schedules?vehicleId=…
 * Vehicle maintenance schedules with LIVE-computed status (schedule:read).
 * Status is calculated from the current odometer + date on every read —
 * never a stale cron-written label.
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.SCHEDULE_READ);

    const vehicleId = request.nextUrl.searchParams.get("vehicleId");
    if (!vehicleId) throw ApiError.badRequest("vehicleId is required");
    const vehicle = await getVehicleById(vehicleId);
    if (!vehicle) throw ApiError.notFound("Vehicle not found");

    const schedules = await listSchedules(vehicleId);
    const now = new Date();
    const evaluated = schedules.map((schedule) => {
      const result = computeScheduleStatus({
        intervalKm: schedule.intervalKm,
        intervalDays: schedule.intervalDays,
        dueSoonKm: schedule.dueSoonKm,
        dueSoonDays: schedule.dueSoonDays,
        lastServiceOdometerKm: schedule.lastServiceOdometerKm,
        lastServiceDate: schedule.lastServiceDate,
        currentOdometerKm: vehicle.odometerKm,
        now,
      });
      return {
        ...schedule,
        status: result.status,
        nextDueOdometerKm: result.nextDueOdometerKm,
        nextDueDate: result.nextDueDate,
        remainingKm: result.remainingKm,
        remainingDays: result.remainingDays,
        odometerState: result.odometerState,
        timeState: result.timeState,
        computed: result.computed,
        note: result.note ?? null,
      };
    });

    return jsonOk({
      schedules: evaluated,
      currentOdometerKm: vehicle.odometerKm,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/maintenance/schedules
 * Configure a vehicle-specific maintenance task (schedule:manage).
 *
 * Without a baseline the task is NOT_CONFIGURED — the UI shows setup is
 * incomplete rather than inventing a due point. Baselines move only through
 * recorded service completion afterwards.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.SCHEDULE_MANAGE);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ApiError.badRequest("Invalid JSON body");

    const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId : "";
    const taskName = typeof body.taskName === "string" ? body.taskName.trim() : "";
    const intervalKm = body.intervalKm === undefined ? undefined : Number(body.intervalKm);
    const intervalDays = body.intervalDays === undefined ? undefined : Number(body.intervalDays);

    if (!vehicleId) throw ApiError.badRequest("vehicleId is required");
    const vehicle = await getVehicleById(vehicleId);
    if (!vehicle) throw ApiError.badRequest("Unknown vehicleId");
    if (!taskName || taskName.length > 200) {
      throw ApiError.badRequest("taskName is required (max 200 chars)");
    }
    if (intervalKm === undefined && intervalDays === undefined) {
      throw ApiError.badRequest("At least one of intervalKm or intervalDays is required");
    }
    if (intervalKm !== undefined && (!Number.isFinite(intervalKm) || intervalKm <= 0)) {
      throw ApiError.badRequest("intervalKm must be a positive number");
    }
    if (intervalDays !== undefined && (!Number.isFinite(intervalDays) || intervalDays <= 0)) {
      throw ApiError.badRequest("intervalDays must be a positive number");
    }

    const lastServiceOdometerKm =
      body.lastServiceOdometerKm === undefined ? undefined : Number(body.lastServiceOdometerKm);
    if (
      lastServiceOdometerKm !== undefined &&
      (!Number.isSafeInteger(lastServiceOdometerKm) || lastServiceOdometerKm < 0)
    ) {
      throw ApiError.badRequest("lastServiceOdometerKm must be a non-negative integer");
    }
    let lastServiceDate: Date | undefined;
    if (body.lastServiceDate !== undefined) {
      lastServiceDate = new Date(String(body.lastServiceDate));
      if (Number.isNaN(lastServiceDate.getTime())) {
        throw ApiError.badRequest("lastServiceDate must be a valid date");
      }
    }

    const schedule = await createSchedule({
      vehicleId,
      templateId: typeof body.templateId === "string" ? body.templateId : undefined,
      taskName,
      category: typeof body.category === "string" ? body.category : undefined,
      intervalKm,
      intervalDays,
      dueSoonKm: body.dueSoonKm === undefined ? undefined : Number(body.dueSoonKm),
      dueSoonDays: body.dueSoonDays === undefined ? undefined : Number(body.dueSoonDays),
      lastServiceOdometerKm,
      lastServiceDate,
      source: typeof body.source === "string" ? body.source.slice(0, 300) : undefined,
      notes: typeof body.notes === "string" ? body.notes.slice(0, 1000) : undefined,
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.SCHEDULE_CREATED,
      actorId: context.user.id,
      entityType: "maintenanceSchedule",
      entityId: schedule.id,
      after: {
        vehicleId,
        taskName,
        intervalKm: intervalKm ?? null,
        intervalDays: intervalDays ?? null,
        baseline: lastServiceOdometerKm ?? null,
      },
      requestId,
    });

    return jsonOk({ schedule }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
