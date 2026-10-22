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

/** Raw values from the unified issue-intake form, as typed by the reporter. */
export interface IssueIntakeValues {
  vehicleId: string;
  title: string;
  description: string;
  /** False means the vehicle must not be driven → server applies a safety hold. */
  drivable: boolean;
  /** Advanced ("More detail") controls — both optional. */
  severity: string;
  category: string;
}

/** The validated POST /api/v1/reports body. */
export interface IssueIntakePayload {
  vehicleId: string;
  title: string;
  description: string;
  severity: ReportSeverity;
  category?: IssueCategory;
  safetyCritical: boolean;
  immobilized: boolean;
}

/**
 * Form values → the issue-report body, or the first message to show the
 * reporter. One intake for every entry point: the only safety-critical input
 * a driver makes is "can this vehicle still be driven?" — an undrivable
 * vehicle is reported CRITICAL + immobilized (the server applies the hold and
 * the driver cannot bypass it), while a drivable one keeps the advanced
 * severity and category choices for optional use.
 */
export function buildIssueIntakePayload(
  values: IssueIntakeValues,
): { ok: true; payload: IssueIntakePayload } | { ok: false; message: string } {
  const vehicleId = values.vehicleId.trim();
  if (!vehicleId) return { ok: false, message: "Choose the vehicle." };

  const title = values.title.trim();
  if (!title || title.length > 200) {
    return { ok: false, message: "A short title is required (max 200 characters)." };
  }

  const description = values.description.trim();
  if (!description || description.length > 5000) {
    return { ok: false, message: "Describe the problem (max 5000 characters)." };
  }

  const drivable = values.drivable === true;
  if (!drivable) {
    return {
      ok: true,
      payload: {
        vehicleId,
        title,
        description,
        severity: "CRITICAL",
        safetyCritical: true,
        immobilized: true,
      },
    };
  }

  const severity = (REPORT_SEVERITIES as readonly string[]).includes(values.severity)
    ? (values.severity as ReportSeverity)
    : "MEDIUM";
  const category = (ISSUE_CATEGORIES as readonly string[]).includes(values.category)
    ? (values.category as IssueCategory)
    : undefined;

  return {
    ok: true,
    payload: {
      vehicleId,
      title,
      description,
      severity,
      ...(category ? { category } : {}),
      // The server treats either flag as safety-critical; keep them in step so
      // an advanced CRITICAL report still restricts the vehicle.
      safetyCritical: severity === "CRITICAL",
      immobilized: false,
    },
  };
}

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
