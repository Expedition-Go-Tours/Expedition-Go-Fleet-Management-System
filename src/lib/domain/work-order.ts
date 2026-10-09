import { PERMISSIONS } from "@/lib/auth/permissions";
import type { ActionMap } from "@/lib/domain/lifecycle";

/* Work order domain model + lifecycle. */

export const WORK_ORDER_STATUSES = ["OPEN", "IN_PROGRESS", "COMPLETED", "CLOSED"] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const WORK_ORDER_PRIORITIES = ["NORMAL", "HIGH", "URGENT"] as const;
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];

export interface WorkOrder {
  id: string;
  vehicleId: string;
  /** Set when the work order was raised from a maintenance report. */
  reportId?: string;
  title: string;
  description: string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  /** User id of the assignee (mechanic/technician). */
  assignedTo?: string;
  completedAt?: Date;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

/**
 * Work order transitions — a strict forward pipeline with an explicit reopen.
 *  OPEN →(start) IN_PROGRESS →(complete) COMPLETED →(close) CLOSED →(reopen) OPEN
 */
export const WORK_ORDER_ACTIONS = {
  start: {
    permission: PERMISSIONS.WORK_ORDER_UPDATE,
    from: ["OPEN"],
    to: "IN_PROGRESS",
  },
  complete: {
    permission: PERMISSIONS.WORK_ORDER_COMPLETE,
    from: ["IN_PROGRESS"],
    to: "COMPLETED",
  },
  close: {
    permission: PERMISSIONS.WORK_ORDER_CLOSE,
    from: ["COMPLETED"],
    to: "CLOSED",
  },
  reopen: {
    permission: PERMISSIONS.WORK_ORDER_REOPEN,
    from: ["CLOSED"],
    to: "OPEN",
  },
} as const satisfies ActionMap<WorkOrderStatus>;
