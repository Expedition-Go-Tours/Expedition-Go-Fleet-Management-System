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
  it("DRIVER can record odometer, inspect, and report own issues only", () => {
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.ODOMETER_RECORD)).toBe(true);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.INSPECTION_SUBMIT)).toBe(true);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.REPORT_CREATE)).toBe(true);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.REPORT_READ_OWN)).toBe(true);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.REPORT_READ_ALL)).toBe(false);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.VEHICLE_RELEASE)).toBe(false);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.ODOMETER_CORRECT)).toBe(false);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.ASSIGNMENT_CREATE)).toBe(false);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.WORK_ORDER_COMPLETE)).toBe(false);
  });

  it("FINANCE records money but cannot run repairs, release, or assign", () => {
    expect(rolesHavePermission(["FINANCE"], PERMISSIONS.EXPENSE_CREATE)).toBe(true);
    expect(rolesHavePermission(["FINANCE"], PERMISSIONS.EXPENSE_VOID)).toBe(true);
    expect(rolesHavePermission(["FINANCE"], PERMISSIONS.EXPENSE_EXPORT)).toBe(true);
    expect(rolesHavePermission(["FINANCE"], PERMISSIONS.FUEL_CREATE)).toBe(true);
    expect(rolesHavePermission(["FINANCE"], PERMISSIONS.WORK_ORDER_CREATE)).toBe(false);
    expect(rolesHavePermission(["FINANCE"], PERMISSIONS.WORK_ORDER_COMPLETE)).toBe(false);
    expect(rolesHavePermission(["FINANCE"], PERMISSIONS.VEHICLE_RELEASE)).toBe(false);
    expect(rolesHavePermission(["FINANCE"], PERMISSIONS.REPORT_TRIAGE)).toBe(false);
  });

  it("MAINTENANCE runs repairs and records service but cannot release by default", () => {
    expect(rolesHavePermission(["MAINTENANCE"], PERMISSIONS.WORK_ORDER_CREATE)).toBe(true);
    expect(rolesHavePermission(["MAINTENANCE"], PERMISSIONS.WORK_ORDER_COMPLETE)).toBe(true);
    expect(rolesHavePermission(["MAINTENANCE"], PERMISSIONS.WORK_ORDER_WAIT)).toBe(true);
    expect(rolesHavePermission(["MAINTENANCE"], PERMISSIONS.WORK_ORDER_VERIFY)).toBe(true);
    expect(rolesHavePermission(["MAINTENANCE"], PERMISSIONS.SERVICE_RECORD)).toBe(true);
    expect(rolesHavePermission(["MAINTENANCE"], PERMISSIONS.SCHEDULE_MANAGE)).toBe(true);
    expect(rolesHavePermission(["MAINTENANCE"], PERMISSIONS.MAINTENANCE_TEMPLATE_MANAGE)).toBe(
      true,
    );
    expect(rolesHavePermission(["MAINTENANCE"], PERMISSIONS.EXPENSE_CREATE)).toBe(false);
    expect(rolesHavePermission(["MAINTENANCE"], PERMISSIONS.VEHICLE_RELEASE)).toBe(false);
  });

  it("OPERATIONS triages and manages assignments/incidents, not repairs", () => {
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.REPORT_TRIAGE)).toBe(true);
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.ASSIGNMENT_CREATE)).toBe(true);
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.INCIDENT_MANAGE)).toBe(true);
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.WORK_ORDER_CREATE)).toBe(false);
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.SERVICE_RECORD)).toBe(false);
    expect(rolesHavePermission(["OPERATIONS"], PERMISSIONS.EXPENSE_CREATE)).toBe(false);
  });

  it("ADMIN administers users but never bypasses the release invariant", () => {
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.USER_INVITE)).toBe(true);
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.USER_ROLE_ASSIGN)).toBe(true);
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.SETTINGS_UPDATE)).toBe(true);
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.VEHICLE_RELEASE)).toBe(false);
  });

  it("MANAGER has oversight reads and user:read only", () => {
    expect(rolesHavePermission(["MANAGER"], PERMISSIONS.USER_READ)).toBe(true);
    expect(rolesHavePermission(["MANAGER"], PERMISSIONS.ASSIGNMENT_READ)).toBe(true);
    expect(rolesHavePermission(["MANAGER"], PERMISSIONS.REPORT_READ_ALL)).toBe(true);
    expect(rolesHavePermission(["MANAGER"], PERMISSIONS.USER_ROLE_ASSIGN)).toBe(false);
    expect(rolesHavePermission(["MANAGER"], PERMISSIONS.EXPENSE_CREATE)).toBe(false);
  });

  it("defaults to deny for unknown roles", () => {
    expect(rolesHavePermission(["SUPERUSER" as never], PERMISSIONS.VEHICLE_READ)).toBe(false);
  });

  it("unions permissions across multiple roles", () => {
    const set = permissionsForRoles(["DRIVER", "FINANCE"]);
    expect(set.has(PERMISSIONS.REPORT_READ_OWN)).toBe(true);
    expect(set.has(PERMISSIONS.EXPENSE_VOID)).toBe(true);
    expect(set.has(PERMISSIONS.VEHICLE_RELEASE)).toBe(false);
  });
});
