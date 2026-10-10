import { PERMISSIONS } from "@/lib/auth/permissions";
import type { ActionMap } from "@/lib/domain/lifecycle";

/*
 * Incident reports — breakdown/accident/passenger/security events.
 *
 * Restricted scope: anyone with incident:create reports; only users with
 * incident:manage may move an incident through the review lifecycle. Own
 * reports are readable by the reporter; incident:read:all reads everything.
 */

export const INCIDENT_TYPES = ["BREAKDOWN", "ACCIDENT", "PASSENGER", "SECURITY", "OTHER"] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const INCIDENT_STATUSES = ["OPEN", "UNDER_REVIEW", "RESOLVED"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export interface IncidentReport {
  id: string;
  vehicleId: string;
  type: IncidentType;
  /** When the event happened (may differ from createdAt for late reports). */
  occurredAt: Date;
  location?: string;
  description: string;
  severity: (typeof INCIDENT_SEVERITIES)[number] | string;
  reportedByUserId: string;
  status: IncidentStatus;
  resolution?: string;
  resolvedByUserId?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Incident lifecycle:
 *   OPEN →(start_review) UNDER_REVIEW →(resolve) RESOLVED
 *   OPEN →(resolve) RESOLVED
 * Resolution requires a note (checked in the route's apply hook) and is
 * audited with the actor id.
 */
export const INCIDENT_ACTIONS = {
  start_review: {
    permission: PERMISSIONS.INCIDENT_MANAGE,
    from: ["OPEN"],
    to: "UNDER_REVIEW",
  },
  resolve: {
    permission: PERMISSIONS.INCIDENT_MANAGE,
    from: ["OPEN", "UNDER_REVIEW"],
    to: "RESOLVED",
  },
} as const satisfies ActionMap<IncidentStatus>;
