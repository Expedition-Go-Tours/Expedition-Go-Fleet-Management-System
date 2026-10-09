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
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const context = await getAuthContext();
  if (!context) redirect("/sign-in");
  if (context.session.mustChangePassword) redirect("/change-password");

  const permissions = [...permissionsForRoles(context.user.roles)];

  return (
    <AppShell user={toPublicUser(context.user)} permissions={permissions}>
      {children}
    </AppShell>
  );
}
