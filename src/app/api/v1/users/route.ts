import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import { generateTempPassword } from "@/lib/auth/passwords";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ROLE_KEYS, toPublicUser } from "@/lib/auth/types";
import { getAdminAuth } from "@/lib/firebase/admin";
import { AUDIT_EVENTS, writeAuditEvent } from "@/lib/repos/audit";
import { createUserRecord, getUserByEmail, listUsers } from "@/lib/repos/users";

export const runtime = "nodejs";

/**
 * GET /api/v1/users
 * List all users. Requires user:read permission.
 */
export async function GET() {
  try {
    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.USER_READ);

    const users = await listUsers();
    return jsonOk({ users: users.map(toPublicUser) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/users
 * Invite a new user. Requires user:invite permission.
 * Returns the temporary password ONCE — it is never stored anywhere and the
 * admin must share it with the invitee out-of-band (phone/WhatsApp). The invitee
 * must change it on first sign-in (enforced server-side).
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await assertCsrfAndOrigin();

    const context = await requireAuthContext();
    requirePermission(context, PERMISSIONS.USER_INVITE);

    const body: unknown = await request.json().catch(() => null);
    const { name, email, phone, roles } = body as {
      name?: unknown;
      email?: unknown;
      phone?: unknown;
      roles?: unknown;
    };

    // Validate input
    if (typeof name !== "string" || name.trim().length === 0) {
      throw ApiError.badRequest("Name is required");
    }
    if (name.trim().length > 200) {
      throw ApiError.badRequest("Name is too long");
    }
    if (typeof email !== "string" || email.trim().length === 0) {
      throw ApiError.badRequest("Email is required");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw ApiError.badRequest("Invalid email address");
    }
    if (!Array.isArray(roles) || roles.length === 0) {
      throw ApiError.badRequest("At least one role is required");
    }
    const validRoles = roles.every((r) => (ROLE_KEYS as readonly string[]).includes(r as string));
    if (!validRoles) {
      throw ApiError.badRequest("Unknown role in roles array");
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check for duplicates (Firestore first, then Firebase Auth).
    const existingByEmail = await getUserByEmail(normalizedEmail);
    if (existingByEmail) {
      throw ApiError.conflict("A user with this email already exists");
    }
    try {
      await getAdminAuth().getUserByEmail(normalizedEmail);
      throw ApiError.conflict("A user with this email already exists in Firebase Auth");
    } catch (e) {
      if (e instanceof ApiError) throw e;
      // auth/user-not-found → proceed. Anything else re-thrown below by Firebase.
    }

    // Generate a temporary password the admin shares out-of-band.
    const tempPassword = generateTempPassword();

    let authUser;
    try {
      authUser = await getAdminAuth().createUser({
        email: normalizedEmail,
        password: tempPassword,
        displayName: name.trim(),
      });
    } catch (e) {
      if ((e as { code?: string })?.code === "auth/email-already-exists") {
        throw ApiError.conflict("A user with this email already exists in Firebase Auth");
      }
      throw e;
    }

    const user = await createUserRecord({
      firebaseUid: authUser.uid,
      name: name.trim(),
      email: normalizedEmail,
      phone: typeof phone === "string" && phone.trim().length > 0 ? phone.trim() : undefined,
      roles: roles as import("@/lib/auth/types").RoleKey[],
      status: "INVITED",
      mustChangePassword: true,
    });

    await writeAuditEvent({
      eventType: AUDIT_EVENTS.INVITE_CREATED,
      actorId: context.user.id,
      entityType: "user",
      entityId: user.id,
      after: { email: user.email, roles: user.roles },
      requestId,
    });

    // The temp password appears exactly once, in this response only.
    return jsonOk({ user: toPublicUser(user), tempPassword }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
