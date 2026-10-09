import type { AppUser } from "@/lib/auth/types";

/*
 * Safety invariants (AUTHENTICATION_AUTHORIZATION.md §6.5).
 *
 * The last active administrator cannot be disabled or demoted without an
 * approved recovery procedure. These helpers are pure so they can be unit-tested
 * against arbitrary user collections.
 */

/**
 * Returns true when demoting (removing the ADMIN role from) or disabling
 * `targetId` would leave zero active administrators — i.e. the target is the
 * last active ADMIN and the action would remove them from the active-admin set.
 * (Both actions remove the target from that set, so the check is identical.)
 *
 * Targets that are not ACTIVE, or that do not hold the ADMIN role, are never
 * considered "last admin".
 */
export function wouldRemoveLastAdmin(
  users: Pick<AppUser, "id" | "status" | "roles">[],
  targetId: string,
): boolean {
  const target = users.find((u) => u.id === targetId);
  if (!target) return false;
  if (!target.roles.includes("ADMIN")) return false;
  if (target.status !== "ACTIVE") return false;

  const otherActiveAdmins = users.filter(
    (u) => u.id !== targetId && u.status === "ACTIVE" && u.roles.includes("ADMIN"),
  ).length;

  return otherActiveAdmins === 0;
}
