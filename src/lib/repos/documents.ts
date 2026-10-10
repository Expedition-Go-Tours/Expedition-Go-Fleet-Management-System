import type { DocumentData } from "firebase-admin/firestore";

import type { VehicleDocument } from "@/lib/domain/document";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import { toDate } from "@/lib/repos/timestamps";

/** Firestore-backed vehicle document repository. */

function documentsRef() {
  return getAdminDb().collection(COLLECTIONS.vehicleDocuments);
}

function toDocument(id: string, data: DocumentData): VehicleDocument {
  return {
    id,
    vehicleId: String(data.vehicleId ?? ""),
    category: String(data.category ?? "OTHER"),
    issueDate: data.issueDate ? String(data.issueDate) : undefined,
    expiryDate: data.expiryDate ? String(data.expiryDate) : undefined,
    fileKey: data.fileKey ? String(data.fileKey) : undefined,
    notes: data.notes ? String(data.notes) : undefined,
    mandatory: data.mandatory === true,
    uploadedBy: String(data.uploadedBy ?? ""),
    createdAt: toDate(data.createdAt) ?? new Date(0),
    updatedAt: toDate(data.updatedAt) ?? new Date(0),
  };
}

export interface UpsertDocumentInput {
  vehicleId: string;
  category: string;
  issueDate?: string;
  expiryDate?: string;
  fileKey?: string;
  notes?: string;
  mandatory: boolean;
  uploadedBy: string;
}

export async function createDocument(input: UpsertDocumentInput): Promise<VehicleDocument> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const now = FieldValue.serverTimestamp();
  const doc = await documentsRef().add({
    ...input,
    issueDate: input.issueDate ?? null,
    expiryDate: input.expiryDate ?? null,
    fileKey: input.fileKey ?? null,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  });
  const created = await getDocumentById(doc.id);
  if (!created) throw new Error("Document not found after creation");
  return created;
}

export async function getDocumentById(id: string): Promise<VehicleDocument | null> {
  const snap = await documentsRef().doc(id).get();
  if (!snap.exists) return null;
  return toDocument(snap.id, snap.data() ?? {});
}

export async function listDocuments(vehicleId: string): Promise<VehicleDocument[]> {
  const snap = await documentsRef().where("vehicleId", "==", vehicleId).limit(200).get();
  return snap.docs.map((d) => toDocument(d.id, d.data()));
}

/** Documents expiring within the threshold across the fleet (reminder feed). */
export async function listDocumentsExpiringSoon(
  now: Date,
  warningDays: number,
  limit = 500,
): Promise<{ document: VehicleDocument; daysLeft: number }[]> {
  const snap = await documentsRef().limit(limit).get();
  const results: { document: VehicleDocument; daysLeft: number }[] = [];
  const horizon = now.getTime() + warningDays * 24 * 60 * 60 * 1000;
  for (const d of snap.docs) {
    const document = toDocument(d.id, d.data());
    if (!document.expiryDate) continue;
    const expiry = new Date(`${document.expiryDate}T23:59:59Z`).getTime();
    if (Number.isNaN(expiry)) continue;
    if (expiry <= horizon) {
      results.push({ document, daysLeft: Math.ceil((expiry - now.getTime()) / 86400000) });
    }
  }
  return results.sort((a, b) => a.daysLeft - b.daysLeft);
}

export async function updateDocument(
  id: string,
  fields: Partial<UpsertDocumentInput>,
): Promise<VehicleDocument> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const cleaned = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  await documentsRef()
    .doc(id)
    .update({ ...cleaned, updatedAt: FieldValue.serverTimestamp() });
  const updated = await getDocumentById(id);
  if (!updated) throw new Error("Document not found after update");
  return updated;
}
