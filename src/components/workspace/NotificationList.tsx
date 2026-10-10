"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { api } from "@/lib/client/api";

export interface WorkspaceNotification {
  id: string;
  title: string;
  body?: string;
  type: string;
  createdAt: string;
  read: boolean;
}

/** Renders the caller's notifications with per-item "mark read". */
export function NotificationList({ notifications }: { notifications: WorkspaceNotification[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function markRead(id: string) {
    setBusy(id);
    try {
      await api.post(`/api/v1/notifications/${id}/read`);
      router.refresh();
    } catch {
      // Non-fatal — the list still renders.
    } finally {
      setBusy(null);
    }
  }

  if (notifications.length === 0) {
    return <p className="text-body-xs text-muted px-5 py-6">No notifications.</p>;
  }

  return (
    <ul className="divide-hairline divide-y">
      {notifications.map((n) => (
        <li key={n.id} className="flex items-start justify-between gap-3 px-5 py-3">
          <div className="min-w-0">
            <p className={n.read ? "text-body-sm text-muted" : "text-body-sm font-medium"}>
              {n.title}
            </p>
            {n.body && <p className="text-body-xs text-muted mt-0.5">{n.body}</p>}
            <p className="font-ui text-muted mt-1 text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
              {n.type.replace(/_/g, " ")} · {n.createdAt}
            </p>
          </div>
          {!n.read && (
            <Button size="sm" variant="outline" disabled={busy === n.id} onClick={() => markRead(n.id)}>
              {busy === n.id ? "…" : "Mark read"}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}