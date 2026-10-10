"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell, Check } from "lucide-react";

import { cn } from "@/lib/cn";
import { api } from "@/lib/client/api";
import { useRouter } from "next/navigation";

export interface BellNotification {
  id: string;
  title: string;
  body?: string;
  type: string;
  linkUrl: string;
  read: boolean;
  createdAt: string;
}

/**
 * Header notification bell: unread badge + popover list with per-item mark-read
 * and a link to the full notification centre.
 */
export function NotificationBell({
  notifications,
  unreadCount,
}: {
  notifications: BellNotification[];
  unreadCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function markRead(id: string) {
    setBusyId(id);
    try {
      await api.post(`/api/v1/notifications/${id}/read`);
      router.refresh();
    } catch {
      // Non-fatal.
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
        className="hover:bg-subtle relative flex h-9 w-9 items-center justify-center rounded-md text-ink transition-colors"
      >
        <Bell aria-hidden="true" className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Notifications"
          className="border-hairline bg-surface absolute right-0 top-11 z-40 w-80 overflow-hidden rounded-lg border shadow-[var(--shadow-lg)]"
        >
          <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
            <p className="font-heading text-card-title font-semibold text-ink">Notifications</p>
            <Link href="/notifications" onClick={() => setOpen(false)} className="text-body-xs font-medium text-link hover:underline">
              View all
            </Link>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 && (
              <p className="px-4 py-6 text-center text-[var(--fs-body-xs)] text-muted">
                You&apos;re all caught up.
              </p>
            )}
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={cn(
                  "flex items-start gap-3 border-b border-hairline px-4 py-3 last:border-b-0",
                  !notification.read && "bg-accent/5",
                )}
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={notification.linkUrl || "/notifications"}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "text-data block truncate hover:text-ink",
                      notification.read ? "font-medium text-ink" : "font-semibold text-ink",
                    )}
                  >
                    {notification.title}
                  </Link>
                  {notification.body && (
                    <p className="text-data-xs mt-0.5 line-clamp-2 text-muted">{notification.body}</p>
                  )}
                  <p className="font-ui text-data-xs mt-1 uppercase tracking-[var(--tracking-ui)] text-faint">
                    {notification.type.replace(/_/g, " ")} · {notification.createdAt}
                  </p>
                </div>
                {!notification.read && (
                  <button
                    type="button"
                    aria-label={`Mark "${notification.title}" as read`}
                    disabled={busyId === notification.id}
                    onClick={() => markRead(notification.id)}
                    className="hover:bg-subtle mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-hairline text-faint transition-colors hover:text-ink"
                  >
                    <Check aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}