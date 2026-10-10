import { PERMISSIONS } from "@/lib/auth/permissions";
import type { ActionMap } from "@/lib/domain/lifecycle";

/* Work order domain model + lifecycle. */

export const WORK_ORDER_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING",
  "COMPLETED",
  "VERIFIED",
  "CLOSED",
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const WORK_ORDER_PRIORITIES = ["NORMAL", "HIGH", "URGENT"] as const;
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];

export interface WorkOrder {
  id: string;
  /** Human-readable reference, e.g. WO-2026-000123. */
  number: string;
  vehicleId: string;
  /** Originating report/issue ids (many-to-many via workOrderIssues too). */
  issueIds: string[];
  /** Preventive-maintenance schedules this work addresses. */
  scheduleIds: string[];
  title: string;
  description: string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  assignedToUserId?: string;
  providerId?: string;
  providerName?: string;
  openedAt: Date;
  startedAt?: Date;
  /** Set when the work was paused (waiting for parts/provider/customer). */
  waitingSince?: Date;
  waitingReason?: string;
  /** Completion evidence — required before COMPLETED. */
  completedAt?: Date;
  completionOdometerKm?: number;
  workPerformed?: string;
  outcome?: string;
  completedByUserId?: string;
  serviceRecordId?: string;
  /** Verification for safety-critical work before CLOSE. */
  verifiedAt?: Date;
  verifiedByUserId?: string;
  verificationNote?: string;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

/**
 * Work-order pipeline.
 *  OPEN →(start) IN_PROGRESS ⇄(wait/continue) WAITING →(complete) COMPLETED
 *  →(verify) VERIFIED →(close) CLOSED; CLOSED →(reopen) OPEN.
 *
 * `complete` is NOT an action-map entry: the completion route requires the
 * evidence fields and runs the service-record workflow. `verify` requires the
 * work_order:verify permission so safety-critical work is checked by an
 * authorized person.
 */
export const WORK_ORDER_ACTIONS = {
  start: {
    permission: PERMISSIONS.WORK_ORDER_UPDATE,
    from: ["OPEN"],
    to: "IN_PROGRESS",
  },
  wait: {
    permission: PERMISSIONS.WORK_ORDER_WAIT,
    from: ["IN_PROGRESS"],
    to: "WAITING",
  },
  resume: {
    permission: PERMISSIONS.WORK_ORDER_UPDATE,
    from: ["WAITING"],
    to: "IN_PROGRESS",
  },
  verify: {
    permission: PERMISSIONS.WORK_ORDER_VERIFY,
    from: ["COMPLETED"],
    to: "VERIFIED",
  },
  close: {
    permission: PERMISSIONS.WORK_ORDER_CLOSE,
    from: ["VERIFIED", "COMPLETED"],
    to: "CLOSED",
  },
  reopen: {
    permission: PERMISSIONS.WORK_ORDER_REOPEN,
    from: ["CLOSED"],
    to: "OPEN",
  },
} as const satisfies ActionMap<WorkOrderStatus>;

/** Statuses the completion endpoint accepts work from. */
export const COMPLETABLE_STATUSES: readonly WorkOrderStatus[] = ["OPEN", "IN_PROGRESS", "WAITING"];

/**
 * Canonical, human-readable action labels. Both the board and the detail page
 * render these so casing/wording never drifts between the two surfaces.
 */
export const WORK_ORDER_ACTION_LABELS: Record<keyof typeof WORK_ORDER_ACTIONS, string> = {
  start: "Start work",
  wait: "Wait (parts/provider)",
  resume: "Resume",
  verify: "Verify work",
  close: "Close",
  reopen: "Reopen",
};
