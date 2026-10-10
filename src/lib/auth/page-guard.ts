import { notFound } from "next/navigation";

import { requireAuthContext } from "@/lib/auth/guards";
import { rolesHavePermission, type PermissionKey } from "@/lib/auth/permissions";
import type { AuthContext } from "@/lib/auth/types";

/**
 * Page-level authorization guard.
 *
 * The API guard throws 401/403 for machine clients; a browser page instead
 * renders the 404 not-found view so an authenticated-but-unauthorized visitor
 * cannot confirm that the route (or the records behind it) exists. The
 * `(app)` layout has already redirected unauthenticated visitors and
 * must-change-password sessions, so this only evaluates permissions.
 *
 * Hiding a navigation item is presentation; this is the page's own enforcement
 * (AUTHENTICATION_AUTHORIZATION.md §6.2 / §9).
 */
export async function requirePagePermission(
  permission: PermissionKey | readonly PermissionKey[],
): Promise<AuthContext> {
  const context = await requireAuthContext();
  const required = typeof permission === "string" ? [permission] : permission;
  const allowed = required.some((key) => rolesHavePermission(context.user.roles, key));
  if (!allowed) notFound();
  return context;
}
