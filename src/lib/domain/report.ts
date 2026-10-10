import { PERMISSIONS } from "@/lib/auth/permissions";
import type { ActionMap } from "@/lib/domain/lifecycle";

/*
 * VehicleIssue (persisted in the legacy `maintenanceReports` collection).
 *
 * A reported defect requiring assessment, correction, monitoring or formal
 * closure. NOT a repair, NOT a work order, NOT an inspection — see
 * FLEET_DOMAIN_MODEL.md for the domain distinctions.
 */

export const REPORT_STATUSES = ["OPEN", "TRIAGED", "CLOSED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type ReportSeverity = (typeof REPORT_SEVERITIES)[number];

export const ISSUE_CATEGORIES = [
  "MECHANICAL",
  "BRAKES",
  "TYRES",
  "ENGINE",
  "ELECTRICAL",
  "FLUID_LEAK",
  "BODY_DAMAGE",
  "WARNING_LIGHT",
  "COMFORT",
  "CLEANLINESS",
  "BREAKDOWN",
  "OTHER",
] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export interface IssueFollowUp {
  byUserId: string;
  text: string;
  at: Date;
  evidenceKeys: string[];
}

export interface MaintenanceReport {
  id: string;
  /** Human-readable reference, e.g. ISS-2026-000123. */
  number?: string;
  vehicleId: string;
  /** Authenticated employee who reported — set server-side only. */
  reportedBy: string;
  title: string;
  description: string;
  severity: ReportSeverity;
  status: ReportStatus;
  category?: IssueCategory | string;
  /** Critical safety defects trigger an automatic safety hold. */
  safetyCritical?: boolean;
  /** Can the vehicle continue safely under policy? */
  affectsSafeOperation?: boolean;
  /** Vehicle immobilized — cannot be driven at all. */
  immobilized?: boolean;
  odometerKm?: number;
  assignmentId?: string;
  inspectionId?: string;
  inspectionItemId?: string;
  location?: string;
  immediateAction?: string;
  evidenceKeys: string[];
  /** First work order linked (back-compat); full set in linkedWorkOrderIds. */
  workOrderId?: string;
  linkedWorkOrderIds: string[];
  duplicateOfIssueId?: string;
  notActionableReason?: string;
  triagedBy?: string;
  triagedAt?: Date;
  closedBy?: string;
  closedAt?: Date;
  resolvedByWorkOrderId?: string;
  resolvedAt?: Date;
  resolution?: string;
  /** Reporter/staff follow-ups — original report content is never modified. */
  followUps: IssueFollowUp[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Issue transitions.
 *  - triage: operations/maintenance validate and classify an open issue.
 *  - close: valid from OPEN or TRIAGED with a resolution, duplicate link or
 *    not-actionable reason (enforced by the route).
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
