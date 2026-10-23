import { describe, expect, it } from "vitest";

import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  permissionsForRoles,
  rolesHavePermission,
} from "@/lib/auth/permissions";

describe("permission catalog", () => {
  it("uses namespace:key format everywhere", () => {
    for (const key of ALL_PERMISSIONS) {
      expect(key).toMatch(/^[a-z_]+(:[a-z_]+)+$/);
    }
  });

  it("includes the fleet-accountability additions", () => {
    const required = [
      "odometer:read",
      "odometer:record",
      "odometer:correct",
      "work_order:wait",
      "work_order:verify",
      "maintenance:template:manage",
      "schedule:read",
      "schedule:manage",
      "service:record",
      "service:read",
      "service:update",
      "assignment:read",
      "assignment:create",
      "assignment:start",
      "assignment:end",
      "assignment:cancel",
      "inspection:submit",
      "inspection:read",
      "incident:create",
      "incident:read:own",
      "incident:read:all",
      "incident:manage",
      "fuel:read",
      "fuel:create",
      "fuel:update",
      "fuel:delete",
      "expense:delete",
      "service:delete",
      "document:read",
      "document:upload",
      "document:manage",
      "notification:read",
    ];
    for (const key of required) {
      expect(ALL_PERMISSIONS).toContain(key as (typeof ALL_PERMISSIONS)[number]);
    }
  });

  it("no longer contains the in-app approval permission", () => {
    expect(ALL_PERMISSIONS).not.toContain("expense:payment:update");
  });
});

describe("baseline role matrix", () => {
  it("DRIVER drives and also runs the workshop bookkeeping (merged in from MAINTENANCE)", () => {
    // Driving work.
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.ODOMETER_RECORD)).toBe(true);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.INSPECTION_SUBMIT)).toBe(true);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.REPORT_CREATE)).toBe(true);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.REPORT_READ_OWN)).toBe(true);
    // Workshop bookkeeping that used to belong to the MAINTENANCE role.
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.ODOMETER_CORRECT)).toBe(true);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.WORK_ORDER_CREATE)).toBe(true);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.WORK_ORDER_COMPLETE)).toBe(true);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.WORK_ORDER_VERIFY)).toBe(true);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.SERVICE_RECORD)).toBe(true);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.SCHEDULE_MANAGE)).toBe(true);
    // Still cannot release a vehicle from a safety hold, assign other people,
    // move money, or administer accounts.
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.VEHICLE_RELEASE)).toBe(false);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.ASSIGNMENT_CREATE)).toBe(false);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.EXPENSE_CREATE)).toBe(false);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.FUEL_UPDATE)).toBe(false);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.FUEL_DELETE)).toBe(false);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.EXPENSE_DELETE)).toBe(false);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.SERVICE_UPDATE)).toBe(false);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.SERVICE_DELETE)).toBe(false);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.USER_INVITE)).toBe(false);
  });

  it("a driver sees only their own reports — merging roles never widened record scope", () => {
    // The role merge decided *who does the job*; it must not quietly relax the
    // data-scoping rules the specification calls out as hard invariants.
    // A driver reads their own reports and works through work orders, but
    // cannot browse every other driver's incident reports.
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.REPORT_READ_OWN)).toBe(true);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.REPORT_READ_ALL)).toBe(false);
    // The same scoping principle applies to incidents and to money.
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.INCIDENT_READ_OWN)).toBe(true);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.INCIDENT_READ_ALL)).toBe(false);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.EXPENSE_EXPORT)).toBe(false);

    // The roles that coordinate and own the business do see everything.
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.REPORT_READ_ALL)).toBe(true);
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.REPORT_READ_ALL)).toBe(true);
  });

  it("OPERATIONS dispatches and handles money (merged OPERATIONS + FINANCE)", () => {
    // Dispatch and triage (old OPERATIONS).
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.REPORT_TRIAGE)).toBe(true);
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.ASSIGNMENT_CREATE)).toBe(true);
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.INCIDENT_MANAGE)).toBe(true);
    // Money (old FINANCE).
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.EXPENSE_CREATE)).toBe(true);
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.EXPENSE_VOID)).toBe(true);
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.EXPENSE_EXPORT)).toBe(true);
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.FUEL_CREATE)).toBe(true);
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.FUEL_UPDATE)).toBe(true);
    // Records that completed maintenance happened (and books its cost), because
    // the same desk pays the invoice — but still cannot run or release.
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.SERVICE_RECORD)).toBe(true);
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.SERVICE_UPDATE)).toBe(true);
    // Permanent deletion is not part of the operations desk.
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.FUEL_DELETE)).toBe(false);
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.EXPENSE_DELETE)).toBe(false);
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.SERVICE_DELETE)).toBe(false);
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.WORK_ORDER_CREATE)).toBe(false);
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.VEHICLE_RELEASE)).toBe(false);
  });

  it("ADMIN administers users and is the only role that can release a hold", () => {
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.USER_INVITE)).toBe(true);
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.USER_ROLE_ASSIGN)).toBe(true);
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.SETTINGS_UPDATE)).toBe(true);
    // Old MANAGER oversight reads are now part of ADMIN.
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.USER_READ)).toBe(true);
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.EXPENSE_CREATE)).toBe(true);
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.EXPENSE_DELETE)).toBe(true);
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.FUEL_DELETE)).toBe(true);
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.SERVICE_DELETE)).toBe(true);
    // Only ADMIN may clear a safety hold; the route still re-checks open
    // critical issues, so the grant does not bypass the safety invariant.
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.VEHICLE_RELEASE)).toBe(true);
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.VEHICLE_RELEASE)).toBe(false);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.VEHICLE_RELEASE)).toBe(false);
  });

  it("defaults to deny for unknown roles", () => {
    expect(rolesHavePermission(["SUPERUSER" as never], PERMISSIONS.VEHICLE_READ)).toBe(false);
  });

  it("unions permissions across multiple roles", () => {
    const set = permissionsForRoles(["DRIVER", "OPERATIONS"]);
    expect(set.has(PERMISSIONS.REPORT_READ_OWN)).toBe(true);
    expect(set.has(PERMISSIONS.EXPENSE_VOID)).toBe(true);
    expect(set.has(PERMISSIONS.VEHICLE_RELEASE)).toBe(false);
  });
});
