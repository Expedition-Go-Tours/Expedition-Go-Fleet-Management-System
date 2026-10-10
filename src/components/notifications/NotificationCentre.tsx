"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BellRing, CheckCheck, Inbox } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { api } from "@/lib/client/api";

export interface CentreNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  linkUrl: string;
  createdAt: string;
  read: boolean;
}

/** Notification centre: full list with per-item and bulk mark-read. */
export function NotificationCentre({ notifications }: { notifications: CentreNotification[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  async function markRead(id: string) {
    setBusy(id);
    try {
      await api.post(`/api/v1/notifications/${id}/read`);
      router.refresh();
    } catch {
      // Non-fatal
    } finally {
      setBusy(null);
    }
  }

  async function markAllRead() {
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;
    setBulkBusy(true);
    try {
      for (const n of unread) {
        await api.post(`/api/v1/notifications/${n.id}/read`).catch(() => {});
      }
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  if (notifications.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Nothing yet"
        description="System and workflow notifications will appear here — maintenance due, document expiries, failed inspections and safety holds."
      />
    );
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="flex flex-col">
      <div className="border-hairline flex items-center justify-between border-b px-4 py-3">
        <p className="text-body-xs text-muted">
          {unreadCount > 0
            ? `${unreadCount} unread of ${notifications.length}`
            : `All ${notifications.length} read`}
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={unreadCount === 0 || bulkBusy}
          isLoading={bulkBusy}
          onClick={() => void markAllRead()}
        >
          <CheckCheck aria-hidden="true" className="h-4 w-4" />
          Mark all read
        </Button>
      </div>

      <ul className="divide-hairline divide-y">
        {notifications.map((n) => (
          <li
            key={n.id}
            className={`flex items-start justify-between gap-3 px-4 py-3 ${n.read ? "" : "hover:bg-subtle bg-subtle/40"}`}
          >
            <div className="min-w-0">
              <p className={`text-body-sm ${n.read ? "text-muted" : "text-ink font-medium"}`}>
                {n.title}
              </p>
              {n.body && <p className="text-body-xs text-muted mt-0.5">{n.body}</p>}
              <p className="font-ui text-muted mt-1 flex items-center gap-2 text-[length:var(--fs-data-xs)] tracking-[var(--tracking-ui)] uppercase">
                {n.type.replace(/_/g, " ").toLowerCase()}
                <span aria-hidden="true">·</span>
                {n.createdAt}
              </p>
              {n.linkUrl && n.linkUrl !== "/" && (
                <Link
                  href={n.linkUrl}
                  className="text-body-xs text-link mt-1 inline-flex items-center gap-1 font-medium hover:underline"
                >
                  <BellRing aria-hidden="true" className="h-3 w-3" />
                  View record
                </Link>
              )}
            </div>
            {!n.read && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy === n.id}
                onClick={() => markRead(n.id)}
              >
                {busy === n.id ? "…" : "Mark read"}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
