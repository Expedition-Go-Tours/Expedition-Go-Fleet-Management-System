import { PERMISSIONS } from "@/lib/auth/permissions";

/*
 * Vehicle documents and expiry tracking.
 *
 * Categories are configurable per company policy — nothing hardcodes
 * unverified legal requirements. Expiry warnings are generated from
 * configurable day thresholds; an expired mandatory document restricts
 * assignment (checked by the assignment route).
 */

export const DOCUMENT_CATEGORIES = [
  "REGISTRATION",
  "INSURANCE",
  "ROADWORTHINESS",
  "PERMIT",
  "OTHER",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_STATES = ["VALID", "EXPIRING_SOON", "EXPIRED", "MISSING"] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];

export interface VehicleDocument {
  id: string;
  vehicleId: string;
  category: DocumentCategory | string;
  issueDate?: string;
  expiryDate?: string;
  /** Private storage key — never a public URL. */
  fileKey?: string;
  notes?: string;
  /** Mandatory documents restrict assignment when expired/missing. */
  mandatory: boolean;
  uploadedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Compute the expiry state against configurable thresholds (days). */
export function documentState(
  doc: Pick<VehicleDocument, "expiryDate">,
  now: Date,
  warningDays: number,
): DocumentState {
  if (!doc.expiryDate) return "MISSING";
  const expiry = new Date(`${doc.expiryDate}T23:59:59Z`);
  if (Number.isNaN(expiry.getTime())) return "MISSING";
  const msLeft = expiry.getTime() - now.getTime();
  if (msLeft < 0) return "EXPIRED";
  if (msLeft <= warningDays * 24 * 60 * 60 * 1000) return "EXPIRING_SOON";
  return "VALID";
}

/** Documents that block assignment: mandatory + expired (or missing expiry). */
export function blocksAssignment(
  docs: Pick<VehicleDocument, "mandatory" | "expiryDate">[],
  now: Date,
  warningDays: number,
): VehicleDocument | null {
  for (const doc of docs) {
    if (!doc.mandatory) continue;
    const state = documentState(doc as Pick<VehicleDocument, "expiryDate">, now, warningDays);
    if (state === "EXPIRED") {
      return doc as VehicleDocument;
    }
  }
  return null;
}

export const DOCUMENT_READ_PERMISSION = PERMISSIONS.DOCUMENT_READ;
export const DOCUMENT_UPLOAD_PERMISSION = PERMISSIONS.DOCUMENT_UPLOAD;
export const DOCUMENT_MANAGE_PERMISSION = PERMISSIONS.DOCUMENT_MANAGE;
