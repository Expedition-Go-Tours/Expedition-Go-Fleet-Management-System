import { PERMISSIONS } from "@/lib/auth/permissions";

/*
 * Pre-trip / return vehicle inspections.
 *
 * A structured checklist assessment. A FAILED critical item creates a linked
 * VehicleIssue and triggers the safety-hold process — the inspection itself
 * is never treated as a repair.
 */

export const INSPECTION_TYPES = ["PRE_TRIP", "RETURN"] as const;
export type InspectionType = (typeof INSPECTION_TYPES)[number];

export const INSPECTION_RESULTS = ["PASS", "FAIL", "NOT_APPLICABLE"] as const;
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];

export interface InspectionItem {
  /** Stable identifier, e.g. "brakes". */
  key: string;
  label: string;
  /** Critical safety items drive a hold when failed. */
  critical: boolean;
  result: InspectionResult;
  notes?: string;
  evidenceKeys: string[];
}

export interface Inspection {
  id: string;
  vehicleId: string;
  inspectorUserId: string;
  type: InspectionType;
  assignmentId?: string;
  odometerKm: number;
  odometerReadingId?: string;
  items: InspectionItem[];
  overall: InspectionResult;
  /** Issue ids created from failed items (idempotent per item). */
  issueIds: string[];
  submittedAt: Date;
  createdAt: Date;
}

/** The default checklist — configurable per company later. */
export function defaultChecklist(): Omit<InspectionItem, "result" | "notes" | "evidenceKeys">[] {
  return [
    { key: "tyres", label: "Tyres and visible tyre damage", critical: true },
    { key: "brakes", label: "Brakes (pedal, handbrake)", critical: true },
    { key: "steering", label: "Steering", critical: true },
    { key: "lights", label: "Headlights, brake lights, indicators", critical: true },
    { key: "wipers", label: "Wipers and visibility", critical: false },
    { key: "belts", label: "Seat belts", critical: true },
    { key: "leaks", label: "Fluid leaks and visible defects", critical: true },
    { key: "horn", label: "Horn and safety equipment", critical: false },
  ];
}

/** Overall result: FAIL beats NOT_APPLICABLE beats PASS. */
export function overallResult(items: Pick<InspectionItem, "result">[]): InspectionResult {
  if (items.some((i) => i.result === "FAIL")) return "FAIL";
  if (items.some((i) => i.result === "NOT_APPLICABLE")) return "NOT_APPLICABLE";
  return "PASS";
}

/** Permission for submitting inspections (drivers' own workflow). */
export const INSPECTION_SUBMIT_PERMISSION = PERMISSIONS.INSPECTION_SUBMIT;
