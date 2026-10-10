import type { ReactNode } from "react";

import { ShellLayout, type ShellUser } from "@/components/layout/ShellLayout";
import { visibleNavGroups } from "@/components/layout/nav";
import { OnboardingProvider } from "@/components/onboarding/OnboardingProvider";
import type { BellNotification } from "@/components/notifications/NotificationBell";
import type { PublicUser } from "@/lib/auth/types";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatRelative } from "@/lib/format";
import { listNotifications } from "@/lib/repos/notifications";
import { getOnboarding } from "@/lib/repos/onboarding";

/**
 * Application shell. Server-rendered: computes the permission-filtered nav,
 * the caller's unread notification count and the caller's per-employee
 * onboarding state, then hands plain data to the client layout. All
 * interactivity (sidebar, drawer, search, bell, account menu, guided tours)
 * lives in ShellLayout / the onboarding provider.
 */
export async function AppShell({
  user,
  permissions,
  children,
}: {
  user: PublicUser;
  permissions: string[];
  children: ReactNode;
}) {
  const visibleHrefs = visibleNavGroups(permissions).flatMap((group) =>
    group.items.map((item) => item.href),
  );

  // Unread count + the most recent notifications for the bell, merged across
  // every role the user holds (mirrors the notifications API route).
  const merged = new Map<string, Awaited<ReturnType<typeof listNotifications>>[number]>();
  if (permissions.includes(PERMISSIONS.NOTIFICATION_READ)) {
    for (const role of user.roles) {
      for (const notification of await listNotifications({ recipientRole: role, limit: 300 })) {
        merged.set(notification.id, notification);
      }
    }
  }
  const sorted = [...merged.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const unreadCount = sorted.filter((n) => !n.readAt).length;

  const notifications: BellNotification[] = sorted.slice(0, 8).map((notification) => ({
    id: notification.id,
    title: notification.title,
    body: notification.body,
    type: notification.type,
    linkUrl: notification.linkUrl,
    read: Boolean(notification.readAt),
    createdAt: formatRelative(notification.createdAt),
  }));

  // Guided onboarding is stored per employee, so it follows them between
  // devices and is scoped to this user id on the server.
  const onboarding = await getOnboarding(user.id);

  const shellUser: ShellUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    roles: [...user.roles],
  };

  return (
    <OnboardingProvider roles={[...user.roles]} permissions={permissions} initial={onboarding}>
      <ShellLayout
        user={shellUser}
        visibleHrefs={visibleHrefs}
        unreadCount={unreadCount}
        notifications={notifications}
      >
        {children}
      </ShellLayout>
    </OnboardingProvider>
  );
}
