/** Domain types shared across the auth, authorization and audit layers. */

export const USER_STATUSES = ["INVITED", "ACTIVE", "SUSPENDED", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ROLE_KEYS = [
  "ADMIN",
  "MANAGER",
  "OPERATIONS",
  "MAINTENANCE",
  "FINANCE",
  "DRIVER",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

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
}

export function toPublicUser(user: AppUser): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
    roles: user.roles,
    mfaEnabled: Boolean(user.mfaEnabled),
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
  userAgentLabel?: string;
  revokedAt?: Date;
  revokeReason?: string;
}

export interface AuthContext {
  user: AppUser;
  session: SessionRecord;
  isPrivileged: boolean;
}
