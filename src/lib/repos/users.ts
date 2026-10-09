import type { DocumentData } from "firebase-admin/firestore";

import type { AppUser, RoleKey, UserStatus } from "@/lib/auth/types";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";

/** Firestore-backed user repository. Server-only (Admin SDK). */

function usersRef() {
  return getAdminDb().collection(COLLECTIONS.users);
}

function toDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate();
  }
  return undefined;
}

function toAppUser(id: string, data: DocumentData): AppUser {
  return {
    id,
    firebaseUid: String(data.firebaseUid ?? ""),
    name: String(data.name ?? ""),
    email: String(data.email ?? ""),
    phone: data.phone ? String(data.phone) : undefined,
    status: (data.status ?? "INVITED") as UserStatus,
    roles: (data.roles ?? []) as RoleKey[],
    mfaEnabled: Boolean(data.mfaEnabled),
    lastLoginAt: toDate(data.lastLoginAt),
    createdAt: toDate(data.createdAt) ?? new Date(0),
    updatedAt: toDate(data.updatedAt) ?? new Date(0),
    disabledAt: toDate(data.disabledAt),
  };
}

export async function getUserById(id: string): Promise<AppUser | null> {
  const snap = await usersRef().doc(id).get();
  if (!snap.exists) return null;
  return toAppUser(snap.id, snap.data() ?? {});
}

export async function getUserByFirebaseUid(firebaseUid: string): Promise<AppUser | null> {
  const snap = await usersRef().where("firebaseUid", "==", firebaseUid).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0]!;
  return toAppUser(doc.id, doc.data());
}

export async function getUserByEmail(email: string): Promise<AppUser | null> {
  const snap = await usersRef().where("email", "==", email.toLowerCase()).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0]!;
  return toAppUser(doc.id, doc.data());
}

/** Mark an INVITED user ACTIVE on first successful sign-in (invite acceptance). */
export async function activateUser(id: string): Promise<void> {
  const { FieldValue } = await import("firebase-admin/firestore");
  await usersRef()
    .doc(id)
    .update({
      status: "ACTIVE" satisfies UserStatus,
      updatedAt: FieldValue.serverTimestamp(),
    });
}

export async function touchLastLogin(id: string): Promise<void> {
  const { FieldValue } = await import("firebase-admin/firestore");
  await usersRef()
    .doc(id)
    .update({ lastLoginAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
}
