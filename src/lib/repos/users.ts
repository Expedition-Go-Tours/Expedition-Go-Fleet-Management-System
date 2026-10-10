import type { DocumentData } from "firebase-admin/firestore";

import type { AppUser, RoleKey, UserStatus } from "@/lib/auth/types";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";

/** Firestore-backed user repository. Server-only (Admin SDK). */

function usersRef() {
  return getAdminDb().collection(COLLECTIONS.users);
}

function userRolesRef() {
  return getAdminDb().collection(COLLECTIONS.userRoles);
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
    mustChangePassword: Boolean(data.mustChangePassword),
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

export interface CreateUserRecordInput {
  firebaseUid: string;
  name: string;
  email: string;
  phone?: string;
  roles: RoleKey[];
  status: UserStatus;
  mustChangePassword?: boolean;
}

export async function createUserRecord(input: CreateUserRecordInput): Promise<AppUser> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const now = FieldValue.serverTimestamp();
  const data = {
    firebaseUid: input.firebaseUid,
    name: input.name,
    email: input.email.toLowerCase(),
    phone: input.phone ?? null,
    status: input.status,
    roles: input.roles,
    mfaEnabled: false,
    mustChangePassword: input.mustChangePassword ?? true,
    createdAt: now,
    updatedAt: now,
  };
  await usersRef().doc(input.firebaseUid).set(data);
  const created = await getUserById(input.firebaseUid);
  if (!created) throw new Error("User not found after creation");
  return created;
}

/** List all users ordered by creation date (newest first). */
export async function listUsers(): Promise<AppUser[]> {
  const snap = await usersRef().orderBy("createdAt", "desc").limit(1000).get();
  return snap.docs.map((doc) => toAppUser(doc.id, doc.data()));
}

/** Count all users via aggregation (no document download, no limit). */
export async function countUsers(): Promise<number> {
  const snap = await usersRef().count().get();
  return snap.data().count;
}

export async function setUserRoles(
  id: string,
  roles: RoleKey[],
  actorId: string,
): Promise<AppUser> {
  const { FieldValue } = await import("firebase-admin/firestore");
  await usersRef().doc(id).update({
    roles,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Write role assignment history
  await userRolesRef().add({
    userId: id,
    roles,
    assignedBy: actorId,
    assignedAt: FieldValue.serverTimestamp(),
  });

  const updated = await getUserById(id);
  if (!updated) throw new Error("User not found after role update");
  return updated;
}

export async function setUserStatus(id: string, status: UserStatus): Promise<AppUser> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const update: Record<string, unknown> = {
    status,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (status === "DISABLED") {
    update.disabledAt = FieldValue.serverTimestamp();
    update.mustChangePassword = false;
  } else if (status === "ACTIVE") {
    update.disabledAt = FieldValue.delete();
    update.mustChangePassword = false;
  }
  await usersRef().doc(id).update(update);

  const updated = await getUserById(id);
  if (!updated) throw new Error("User not found after status update");
  return updated;
}

export async function activateUser(id: string): Promise<AppUser> {
  const { FieldValue } = await import("firebase-admin/firestore");
  await usersRef()
    .doc(id)
    .update({
      status: "ACTIVE" satisfies UserStatus,
      mustChangePassword: false,
      updatedAt: FieldValue.serverTimestamp(),
    });

  const updated = await getUserById(id);
  if (!updated) throw new Error("User not found after activation");
  return updated;
}

export async function touchLastLogin(id: string): Promise<void> {
  const { FieldValue } = await import("firebase-admin/firestore");
  await usersRef()
    .doc(id)
    .update({ lastLoginAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
}
