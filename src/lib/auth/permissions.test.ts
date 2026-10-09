import { describe, expect, it } from "vitest";

import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  permissionsForRoles,
  rolesHavePermission,
} from "@/lib/auth/permissions";

describe("permission catalog", () => {
  it("exposes every key defined in the spec (§6.3)", () => {
    const expected = [
      "vehicle:read",
      "vehicle:create",
      "vehicle:update",
      "vehicle:archive",
      "vehicle:status:update",
      "vehicle:release",
      "report:create",
      "report:read:own",
      "report:read:all",
      "report:triage",
      "report:update",
      "report:close",
      "work_order:read",
      "work_order:create",
      "work_order:update",
      "work_order:complete",
      "work_order:close",
      "work_order:reopen",
      "expense:read",
      "expense:create",
      "expense:update",
      "expense:void",
      "expense:payment:update",
      "expense:export",
      "provider:read",
      "provider:create",
      "provider:update",
      "audit:read",
      "user:read",
      "user:invite",
      "user:disable",
      "user:role:assign",
      "settings:update",
    ];
    expect([...ALL_PERMISSIONS].sort()).toEqual(expected.sort());
  });
});

describe("baseline role matrix (§6.4)", () => {
  it("DRIVER is narrowly scoped", () => {
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.VEHICLE_READ)).toBe(true);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.REPORT_CREATE)).toBe(true);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.REPORT_READ_OWN)).toBe(true);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.REPORT_READ_ALL)).toBe(false);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.EXPENSE_READ)).toBe(false);
    expect(rolesHavePermission(["DRIVER"], PERMISSIONS.WORK_ORDER_CREATE)).toBe(false);
  });

  it("FINANCE can manage expenses but not repair workflow or vehicle release", () => {
    expect(rolesHavePermission(["FINANCE"], PERMISSIONS.EXPENSE_VOID)).toBe(true);
    expect(rolesHavePermission(["FINANCE"], PERMISSIONS.EXPENSE_PAYMENT_UPDATE)).toBe(true);
    expect(rolesHavePermission(["FINANCE"], PERMISSIONS.EXPENSE_EXPORT)).toBe(true);
    expect(rolesHavePermission(["FINANCE"], PERMISSIONS.WORK_ORDER_CREATE)).toBe(false);
    expect(rolesHavePermission(["FINANCE"], PERMISSIONS.WORK_ORDER_COMPLETE)).toBe(false);
    expect(rolesHavePermission(["FINANCE"], PERMISSIONS.VEHICLE_RELEASE)).toBe(false);
    expect(rolesHavePermission(["FINANCE"], PERMISSIONS.REPORT_TRIAGE)).toBe(false);
  });

  it("MAINTENANCE manages work orders but not payment status or release by default", () => {
    expect(rolesHavePermission(["MAINTENANCE"], PERMISSIONS.WORK_ORDER_CREATE)).toBe(true);
    expect(rolesHavePermission(["MAINTENANCE"], PERMISSIONS.WORK_ORDER_COMPLETE)).toBe(true);
    expect(rolesHavePermission(["MAINTENANCE"], PERMISSIONS.EXPENSE_PAYMENT_UPDATE)).toBe(false);
    expect(rolesHavePermission(["MAINTENANCE"], PERMISSIONS.EXPENSE_VOID)).toBe(false);
    expect(rolesHavePermission(["MAINTENANCE"], PERMISSIONS.VEHICLE_RELEASE)).toBe(false);
  });

  it("ADMIN administers users but never bypasses the release invariant automatically", () => {
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.USER_INVITE)).toBe(true);
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.USER_ROLE_ASSIGN)).toBe(true);
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.USER_DISABLE)).toBe(true);
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.SETTINGS_UPDATE)).toBe(true);
    expect(rolesHavePermission(["ADMIN"], PERMISSIONS.VEHICLE_RELEASE)).toBe(false);
  });

  it("MANAGER cannot assign roles by default", () => {
    expect(rolesHavePermission(["MANAGER"], PERMISSIONS.USER_ROLE_ASSIGN)).toBe(false);
    expect(rolesHavePermission(["MANAGER"], PERMISSIONS.USER_INVITE)).toBe(false);
    expect(rolesHavePermission(["MANAGER"], PERMISSIONS.EXPENSE_READ)).toBe(true);
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
