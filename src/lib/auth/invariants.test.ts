import { describe, expect, it } from "vitest";

import { wouldRemoveLastAdmin } from "@/lib/auth/invariants";
import type { AppUser } from "@/lib/auth/types";

function makeUser(overrides: Partial<AppUser>): AppUser {
  return {
    id: "u1",
    firebaseUid: "fb1",
    name: "Test User",
    email: "test@example.com",
    status: "ACTIVE",
    roles: [],
    mfaEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("wouldRemoveLastAdmin", () => {
  const adminA = makeUser({ id: "admin-a", roles: ["ADMIN"] });
  const adminB = makeUser({ id: "admin-b", roles: ["ADMIN"] });
  const driver = makeUser({ id: "driver-1", roles: ["DRIVER"] });
  const suspendedAdmin = makeUser({ id: "admin-c", status: "SUSPENDED", roles: ["ADMIN"] });
  const disabledAdmin = makeUser({ id: "admin-d", status: "DISABLED", roles: ["ADMIN"] });

  it("returns false when target is not an admin", () => {
    expect(wouldRemoveLastAdmin([driver], "driver-1")).toBe(false);
    expect(wouldRemoveLastAdmin([driver], "driver-1")).toBe(false);
  });

  it("returns false when target admin is not ACTIVE", () => {
    expect(wouldRemoveLastAdmin([suspendedAdmin], "admin-c")).toBe(false);
    expect(wouldRemoveLastAdmin([disabledAdmin], "admin-d")).toBe(false);
  });

  it("returns true for demote when target is the only ACTIVE admin", () => {
    expect(wouldRemoveLastAdmin([adminA], "admin-a")).toBe(true);
  });

  it("returns true for disable when target is the only ACTIVE admin", () => {
    expect(wouldRemoveLastAdmin([adminA], "admin-a")).toBe(true);
  });

  it("returns false when other ACTIVE admins exist", () => {
    expect(wouldRemoveLastAdmin([adminA, adminB], "admin-a")).toBe(false);
    expect(wouldRemoveLastAdmin([adminA, adminB], "admin-a")).toBe(false);
    expect(wouldRemoveLastAdmin([adminA, adminB, driver], "admin-a")).toBe(false);
  });

  it("returns false when other ACTIVE admins exist (suspended/disabled don't count)", () => {
    expect(wouldRemoveLastAdmin([adminA, suspendedAdmin], "admin-a")).toBe(true);
    expect(wouldRemoveLastAdmin([adminA, disabledAdmin], "admin-a")).toBe(true);
  });

  it("handles non-existent target gracefully", () => {
    expect(wouldRemoveLastAdmin([adminA], "non-existent")).toBe(false);
    expect(wouldRemoveLastAdmin([adminA], "non-existent")).toBe(false);
  });
});
