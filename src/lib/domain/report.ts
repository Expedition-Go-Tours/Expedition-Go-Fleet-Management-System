import { PERMISSIONS } from "@/lib/auth/permissions";
import type { ActionMap } from "@/lib/domain/lifecycle";

/* Maintenance report (fault/concern raised by staff) domain model + lifecycle. */

export const REPORT_STATUSES = ["OPEN", "TRIAGED", "CLOSED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type ReportSeverity = (typeof REPORT_SEVERITIES)[number];

export interface MaintenanceReport {
  id: string;
  vehicleId: string;
  /** User id of the reporter (used for report:read:own scoping). */
  reportedBy: string;
  title: string;
  description: string;
  severity: ReportSeverity;
  status: ReportStatus;
  /** Set when a work order is created for this report. */
  workOrderId?: string;
  triagedBy?: string;
  triagedAt?: Date;
  closedBy?: string;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Report transitions.
 *  - triage: operations validates and classifies an open report.
 *  - close: valid from OPEN or TRIAGED (triaged reports can be closed directly;
 *    closing marks the concern resolved/dismissed).
 */
export const REPORT_ACTIONS = {
  triage: {
    permission: PERMISSIONS.REPORT_TRIAGE,
    from: ["OPEN"],
    to: "TRIAGED",
  },
  close: {
    permission: PERMISSIONS.REPORT_CLOSE,
    from: ["OPEN", "TRIAGED"],
    to: "CLOSED",
  },
} as const satisfies ActionMap<ReportStatus>;
