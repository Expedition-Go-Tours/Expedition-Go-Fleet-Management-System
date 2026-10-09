import type { DocumentData } from "firebase-admin/firestore";

import type { Provider } from "@/lib/domain/provider";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import { toDate } from "@/lib/repos/timestamps";

/** Firestore-backed service provider repository. */

function providersRef() {
  return getAdminDb().collection(COLLECTIONS.providers ?? "providers");
}

function toProvider(id: string, data: DocumentData): Provider {
  return {
    id,
    name: String(data.name ?? ""),
    contactName: data.contactName ? String(data.contactName) : undefined,
    phone: String(data.phone ?? ""),
    email: data.email ? String(data.email) : undefined,
    address: data.address ? String(data.address) : undefined,
    specialties: Array.isArray(data.specialties) ? data.specialties.map(String) : [],
    active: data.active !== false,
    createdAt: toDate(data.createdAt) ?? new Date(0),
    updatedAt: toDate(data.updatedAt) ?? new Date(0),
  };
}

export interface CreateProviderInput {
  name: string;
  contactName?: string;
  phone: string;
  email?: string;
  address?: string;
  specialties: string[];
}

export async function createProvider(input: CreateProviderInput): Promise<Provider> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const now = FieldValue.serverTimestamp();
  const doc = await providersRef().add({
    ...input,
    contactName: input.contactName ?? null,
    email: input.email ?? null,
    address: input.address ?? null,
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  const created = await getProviderById(doc.id);
  if (!created) throw new Error("Provider not found after creation");
  return created;
}

export async function getProviderById(id: string): Promise<Provider | null> {
  const snap = await providersRef().doc(id).get();
  if (!snap.exists) return null;
  return toProvider(snap.id, snap.data() ?? {});
}

export async function listProviders(options?: {
  activeOnly?: boolean;
  limit?: number;
}): Promise<Provider[]> {
  const query = providersRef()
    .orderBy("createdAt", "desc")
    .limit(options?.limit ?? 500);
  const snap = await query.get();
  const providers = snap.docs.map((doc) => toProvider(doc.id, doc.data()));
  return options?.activeOnly ? providers.filter((p) => p.active) : providers;
}

export interface UpdateProviderFields {
  name?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  specialties?: string[];
  active?: boolean;
}

export async function updateProvider(id: string, fields: UpdateProviderFields): Promise<Provider> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const cleaned = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
  await providersRef()
    .doc(id)
    .update({
      ...cleaned,
      updatedAt: FieldValue.serverTimestamp(),
    });
  const updated = await getProviderById(id);
  if (!updated) throw new Error("Provider not found after update");
  return updated;
}
