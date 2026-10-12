import type { DocumentData } from "firebase-admin/firestore";

import type { SavedLocation, SavedLocationCategory } from "@/lib/domain/saved-location";
import { validateSavedLocation } from "@/lib/domain/saved-location";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { toDate } from "@/lib/repos/timestamps";

/*
 * Saved company locations repository.
 *
 * Stores frequently used trip origins/destinations (offices, airports, hotels,
 * tour attractions, etc.) so drivers and operations can quickly select them
 * when recording trips.
 */

export class SavedLocationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SavedLocationError";
    this.code = code;
  }
}

function locationsRef() {
  return getAdminDb().collection(COLLECTIONS.savedLocations);
}

function toIsoString(value: unknown): string | null {
  if (!value) return null;
  const d = toDate(value);
  return d ? d.toISOString() : null;
}

function toSavedLocation(id: string, data: DocumentData): SavedLocation {
  return {
    id,
    label: String(data.label ?? ""),
    category: (data.category ?? "OTHER") as SavedLocationCategory,
    address: data.address ? String(data.address) : null,
    latitude: typeof data.latitude === "number" ? data.latitude : null,
    longitude: typeof data.longitude === "number" ? data.longitude : null,
    placeId: data.placeId ? String(data.placeId) : null,
    notes: data.notes ? String(data.notes) : null,
    active: data.active !== false,
    createdBy: String(data.createdBy ?? ""),
    createdAt: toIsoString(data.createdAt) ?? new Date(0).toISOString(),
    updatedAt: toIsoString(data.updatedAt) ?? new Date(0).toISOString(),
  };
}

export interface CreateSavedLocationInput {
  label: string;
  category: SavedLocationCategory;
  address?: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  notes?: string;
  createdBy: string;
}

export async function createSavedLocation(input: CreateSavedLocationInput): Promise<SavedLocation> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const validation = validateSavedLocation({
    label: input.label,
    category: input.category,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
  });
  if (!validation.ok) {
    throw new SavedLocationError("VALIDATION_FAILED", validation.error);
  }

  const ref = locationsRef().doc();
  const now = FieldValue.serverTimestamp();
  const nowIso = new Date().toISOString();

  await ref.set({
    label: input.label.trim(),
    category: input.category,
    address: input.address ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    placeId: input.placeId ?? null,
    notes: input.notes ?? null,
    active: true,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  });

  await writeAuditEvent({
    eventType: AUDIT_EVENTS.SAVED_LOCATION_CREATED,
    actorId: input.createdBy,
    entityType: "savedLocation",
    entityId: ref.id,
    after: { label: input.label, category: input.category },
  });

  return {
    id: ref.id,
    label: input.label.trim(),
    category: input.category,
    address: input.address ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    placeId: input.placeId ?? null,
    notes: input.notes ?? null,
    active: true,
    createdBy: input.createdBy,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export async function updateSavedLocation(
  id: string,
  updates: Partial<CreateSavedLocationInput>,
  actorId: string,
): Promise<SavedLocation> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const db = getAdminDb();
  const ref = locationsRef().doc(id);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new SavedLocationError("NOT_FOUND", "Saved location not found");
    const existing = toSavedLocation(snap.id, snap.data() ?? {});

    const merged = {
      ...existing,
      ...updates,
    };
    const validation = validateSavedLocation(merged);
    if (!validation.ok) {
      throw new SavedLocationError("VALIDATION_FAILED", validation.error);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (updates.label !== undefined) updateData.label = updates.label.trim();
    if (updates.category !== undefined) updateData.category = updates.category;
    if (updates.address !== undefined) updateData.address = updates.address ?? null;
    if (updates.latitude !== undefined) updateData.latitude = updates.latitude ?? null;
    if (updates.longitude !== undefined) updateData.longitude = updates.longitude ?? null;
    if (updates.placeId !== undefined) updateData.placeId = updates.placeId ?? null;
    if (updates.notes !== undefined) updateData.notes = updates.notes ?? null;

    tx.update(ref, updateData);

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.SAVED_LOCATION_UPDATED,
      actorId,
      entityType: "savedLocation",
      entityId: id,
      before: { label: existing.label, category: existing.category },
      after: updateData,
    });

    const updatedSnap = await tx.get(ref);
    return toSavedLocation(updatedSnap.id, updatedSnap.data() ?? {});
  });
}

export async function listSavedLocations(options?: {
  category?: SavedLocationCategory;
  active?: boolean;
}): Promise<SavedLocation[]> {
  let query: import("firebase-admin/firestore").Query = locationsRef();
  if (options?.category) {
    query = query.where("category", "==", options.category);
  }
  const snap = await query.orderBy("label", "asc").limit(200).get();
  let locations = snap.docs.map((d) => toSavedLocation(d.id, d.data()));
  if (options?.active !== undefined) {
    locations = locations.filter((l) => l.active === options.active);
  }
  return locations;
}

export async function getSavedLocationById(id: string): Promise<SavedLocation | null> {
  const snap = await locationsRef().doc(id).get();
  if (!snap.exists) return null;
  return toSavedLocation(snap.id, snap.data() ?? {});
}

export async function deactivateSavedLocation(id: string, actorId: string): Promise<SavedLocation> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const db = getAdminDb();
  const ref = locationsRef().doc(id);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new SavedLocationError("NOT_FOUND", "Saved location not found");

    tx.update(ref, {
      active: false,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.SAVED_LOCATION_UPDATED,
      actorId,
      entityType: "savedLocation",
      entityId: id,
      after: { active: false },
    });

    const updatedSnap = await tx.get(ref);
    return toSavedLocation(updatedSnap.id, updatedSnap.data() ?? {});
  });
}
