/** Domain types shared across the auth, authorization and audit layers. */

export const USER_STATUSES = ["INVITED", "ACTIVE", "SUSPENDED", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * The three operational roles.
 *
 * The fleet runs with three hats: the people doing the driving work, the desk
 * role that dispatches and handles money, and the owner/admin who runs accounts.
 * Three former roles folded in:
 *   - MANAGER → ADMIN (one owner-level role: oversight *and* user management)
 *   - MAINTENANCE → DRIVER (the workshop has no account; the driver takes the
 *     vehicle to the garage and records the work)
 *   - FINANCE → OPERATIONS (dispatch and costs are the same desk job)
 */
export const ROLE_KEYS = ["ADMIN", "OPERATIONS", "DRIVER"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Human-facing role names — the stored keys are uppercase enums. */
export const ROLE_LABELS: Record<RoleKey, string> = {
  ADMIN: "Admin",
  OPERATIONS: "Operations",
  DRIVER: "Driver",
};

export interface AppUser {
  id: string;
  firebaseUid: string;
  name: string;
  email: string;
  phone?: string;
  status: UserStatus;
  /**
   * Current role assignments. This is the authoritative source used for
   * authorization on every request (read fresh — never cached). The `userRoles`
   * collection retains the assignment history for audit.
   */
  roles: RoleKey[];
  mfaEnabled?: boolean;
  /** True while the user must change their password (invite acceptance). */
  mustChangePassword?: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  disabledAt?: Date;
}

/** The user shape safe to return to the browser. */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  roles: RoleKey[];
  mfaEnabled: boolean;
  mustChangePassword: boolean;
}

export function toPublicUser(user: AppUser): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
    roles: user.roles,
    mfaEnabled: Boolean(user.mfaEnabled),
    mustChangePassword: Boolean(user.mustChangePassword),
  };
}

export interface SessionRecord {
  /** SHA-256 hash of the session token — never the raw token. */
  tokenHash: string;
  userId: string;
  createdAt: Date;
  lastSeenAt: Date;
  /** Sliding idle deadline, extended on activity. */
  idleExpiresAt: Date;
  /** Absolute deadline; the session cannot outlive this. */
  expiresAt: Date;
  mfaSatisfied: boolean;
  /**
   * Snapshot of the user's `mustChangePassword` flag at session creation.
   * While true, the session may only call the password-change endpoint.
   */
  mustChangePassword?: boolean;
  /**
   * True when this is a privileged session granted *only* so the user can enroll
   * a second factor (they had none yet, so there was nothing to challenge).
   * While true, the session may only reach the account/MFA screens.
   */
  mfaEnrollmentRequired?: boolean;
  userAgentLabel?: string;
  revokedAt?: Date;
  revokeReason?: string;
}

export interface AuthContext {
  user: AppUser;
  session: SessionRecord;
  isPrivileged: boolean;
}
