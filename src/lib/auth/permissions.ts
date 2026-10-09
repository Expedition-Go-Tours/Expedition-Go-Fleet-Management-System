import type { RoleKey } from "@/lib/auth/types";

/**
 * Explicit permission catalog (see AUTHENTICATION_AUTHORIZATION.md §6.3).
 * Authorization always checks a permission key — never a role name — so the
 * role matrix can evolve without touching endpoint code.
 */
export const PERMISSIONS = {
  VEHICLE_READ: "vehicle:read",
  VEHICLE_CREATE: "vehicle:create",
  VEHICLE_UPDATE: "vehicle:update",
  VEHICLE_ARCHIVE: "vehicle:archive",
  VEHICLE_STATUS_UPDATE: "vehicle:status:update",
  VEHICLE_RELEASE: "vehicle:release",

  REPORT_CREATE: "report:create",
  REPORT_READ_OWN: "report:read:own",
  REPORT_READ_ALL: "report:read:all",
  REPORT_TRIAGE: "report:triage",
  REPORT_UPDATE: "report:update",
  REPORT_CLOSE: "report:close",

  WORK_ORDER_READ: "work_order:read",
  WORK_ORDER_CREATE: "work_order:create",
  WORK_ORDER_UPDATE: "work_order:update",
  WORK_ORDER_COMPLETE: "work_order:complete",
  WORK_ORDER_CLOSE: "work_order:close",
  WORK_ORDER_REOPEN: "work_order:reopen",

  EXPENSE_READ: "expense:read",
  EXPENSE_CREATE: "expense:create",
  EXPENSE_UPDATE: "expense:update",
  EXPENSE_VOID: "expense:void",
  EXPENSE_PAYMENT_UPDATE: "expense:payment:update",
  EXPENSE_EXPORT: "expense:export",

  PROVIDER_READ: "provider:read",
  PROVIDER_CREATE: "provider:create",
  PROVIDER_UPDATE: "provider:update",

  AUDIT_READ: "audit:read",
  USER_READ: "user:read",
  USER_INVITE: "user:invite",
  USER_DISABLE: "user:disable",
  USER_ROLE_ASSIGN: "user:role:assign",
  SETTINGS_UPDATE: "settings:update",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly PermissionKey[] = Object.values(PERMISSIONS);

/**
 * Baseline role → permission matrix (AUTHENTICATION_AUTHORIZATION.md §6.4).
 * Least privilege by default. Per-user grants can extend this later and must be
 * explicit and auditable.
 *
 * Deliberately excluded:
 *  - `vehicle:release` is not automatic for ADMIN ("no automatic bypass"); it is
 *    an explicit, per-user grant subject to the safety-hold invariant.
 *  - `expense:create` for MAINTENANCE is granted ("if granted"), not default.
 */
export const ROLE_PERMISSIONS: Record<RoleKey, readonly PermissionKey[]> = {
  DRIVER: [PERMISSIONS.VEHICLE_READ, PERMISSIONS.REPORT_CREATE, PERMISSIONS.REPORT_READ_OWN],

  OPERATIONS: [
    PERMISSIONS.VEHICLE_READ,
    PERMISSIONS.VEHICLE_UPDATE,
    PERMISSIONS.REPORT_CREATE,
    PERMISSIONS.REPORT_READ_OWN,
    PERMISSIONS.REPORT_READ_ALL,
    PERMISSIONS.REPORT_TRIAGE,
    PERMISSIONS.REPORT_UPDATE,
    PERMISSIONS.WORK_ORDER_READ,
    PERMISSIONS.AUDIT_READ,
  ],

  MAINTENANCE: [
    PERMISSIONS.VEHICLE_READ,
    PERMISSIONS.VEHICLE_UPDATE,
    PERMISSIONS.VEHICLE_STATUS_UPDATE,
    PERMISSIONS.REPORT_CREATE,
    PERMISSIONS.REPORT_READ_OWN,
    PERMISSIONS.REPORT_READ_ALL,
    PERMISSIONS.REPORT_TRIAGE,
    PERMISSIONS.REPORT_UPDATE,
    PERMISSIONS.REPORT_CLOSE,
    PERMISSIONS.WORK_ORDER_READ,
    PERMISSIONS.WORK_ORDER_CREATE,
    PERMISSIONS.WORK_ORDER_UPDATE,
    PERMISSIONS.WORK_ORDER_COMPLETE,
    PERMISSIONS.WORK_ORDER_CLOSE,
    PERMISSIONS.WORK_ORDER_REOPEN,
    PERMISSIONS.EXPENSE_READ,
    PERMISSIONS.PROVIDER_READ,
    PERMISSIONS.PROVIDER_CREATE,
    PERMISSIONS.PROVIDER_UPDATE,
    PERMISSIONS.AUDIT_READ,
  ],

  FINANCE: [
    PERMISSIONS.VEHICLE_READ,
    PERMISSIONS.REPORT_READ_ALL,
    PERMISSIONS.WORK_ORDER_READ,
    PERMISSIONS.EXPENSE_READ,
    PERMISSIONS.EXPENSE_CREATE,
    PERMISSIONS.EXPENSE_UPDATE,
    PERMISSIONS.EXPENSE_VOID,
    PERMISSIONS.EXPENSE_PAYMENT_UPDATE,
    PERMISSIONS.EXPENSE_EXPORT,
    PERMISSIONS.AUDIT_READ,
  ],

  MANAGER: [
    PERMISSIONS.VEHICLE_READ,
    PERMISSIONS.REPORT_CREATE,
    PERMISSIONS.REPORT_READ_OWN,
    PERMISSIONS.REPORT_READ_ALL,
    PERMISSIONS.REPORT_TRIAGE,
    PERMISSIONS.WORK_ORDER_READ,
    PERMISSIONS.EXPENSE_READ,
    PERMISSIONS.PROVIDER_READ,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.USER_READ,
  ],

  // Admin administers access; it does not automatically bypass safety/financial
  // invariants (notably `vehicle:release`).
  ADMIN: ALL_PERMISSIONS.filter((key) => key !== PERMISSIONS.VEHICLE_RELEASE),
};

/** Expand a set of roles into the union of granted permission keys. */
export function permissionsForRoles(roles: readonly RoleKey[]): Set<PermissionKey> {
  const result = new Set<PermissionKey>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) {
      result.add(permission);
    }
  }
  return result;
}

/** True when the roles grant the given permission. Defaults to deny. */
export function rolesHavePermission(roles: readonly RoleKey[], permission: PermissionKey): boolean {
  return roles.some((role) => (ROLE_PERMISSIONS[role] ?? []).includes(permission));
}
