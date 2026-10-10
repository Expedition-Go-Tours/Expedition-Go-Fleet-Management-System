import { NotificationCentre, type CentreNotification } from "@/components/notifications/NotificationCentre";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireAuthContext } from "@/lib/auth/guards";
import { formatDate } from "@/lib/format";
import { listNotifications } from "@/lib/repos/notifications";

export const metadata = { title: "Notifications" };

/**
 * Notification centre: every notification addressed to the caller's roles,
 * newest first. Reads are per-item through the API; the underlying documents
 * are created by the reminder cron with dedupe keys.
 */
export default async function NotificationsPage() {
  const context = await requireAuthContext();

  const byRole = await Promise.all(
    context.user.roles.map((role) => listNotifications({ recipientRole: role, limit: 200 })),
  );
  const merged = new Map<string, (typeof byRole)[number][number]>();
  for (const list of byRole) for (const n of list) merged.set(n.id, n);

  const notifications: CentreNotification[] = [...merged.values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      linkUrl: n.linkUrl,
      createdAt: formatDate(n.createdAt),
      read: Boolean(n.readAt),
    }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        description="Workflow and system alerts addressed to your roles."
        crumbs={[{ label: "Administration" }, { label: "Notifications" }]}
      />
      <Card flush>
        <NotificationCentre notifications={notifications} />
      </Card>
    </div>
  );
}