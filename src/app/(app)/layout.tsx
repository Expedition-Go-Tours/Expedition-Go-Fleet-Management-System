import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { getAuthContext } from "@/lib/auth/guards";
import { permissionsForRoles } from "@/lib/auth/permissions";
import { toPublicUser } from "@/lib/auth/types";

/**
 * Authenticated application layout. Unauthenticated visitors go to /sign-in;
 * users mid-onboarding (restricted temp-password session) go to the password
 * screen — every guarded page inside inherits this protection.
 *
 * Two-factor enrollment is *not* redirected from here: `/account` lives inside
 * this layout, so redirecting would loop. It is enforced per page instead by
 * `assertMfaEnrollmentComplete`, which sends the user to `/account` from
 * everywhere else.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const context = await getAuthContext();
  if (!context) redirect("/sign-in");
  if (context.session.mustChangePassword) redirect("/change-password");

  // A session that exists only to enroll a second factor is shown a minimal
  // shell — matching the empty permission set the session endpoint gives it —
  // rather than a full sidebar whose links all bounce back here.
  const permissions = context.session.mfaEnrollmentRequired
    ? []
    : [...permissionsForRoles(context.user.roles)];

  return (
    <AppShell user={toPublicUser(context.user)} permissions={permissions}>
      {children}
    </AppShell>
  );
}
