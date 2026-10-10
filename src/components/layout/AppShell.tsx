import type { ReactNode } from "react";

import {
  ShellLayout,
  type ShellUser,
} from "@/components/layout/ShellLayout";
import { visibleNavGroups } from "@/components/layout/nav";
import type { BellNotification } from "@/components/notifications/NotificationBell";
import type { PublicUser } from "@/lib/auth/types";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatRelative } from "@/lib/format";
import { listNotifications } from "@/lib/repos/notifications";

/**
 * Application shell. Server-rendered: computes the permission-filtered nav
 * and the caller's unread notification count, then hands plain data to the
 * client layout. All interactivity (sidebar, drawer, search, bell, account
 * menu) lives in ShellLayout.
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

  const shellUser: ShellUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    roles: [...user.roles],
  };

  return (
    <ShellLayout
      user={shellUser}
      visibleHrefs={visibleHrefs}
      unreadCount={unreadCount}
      notifications={notifications}
    >
      {children}
    </ShellLayout>
  );
}