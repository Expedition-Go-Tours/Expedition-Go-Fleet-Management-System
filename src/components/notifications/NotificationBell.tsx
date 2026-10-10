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
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key === "Tab") {
        const popover = popoverRef.current;
        if (!popover) return;
        const focusables = popover.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
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
        data-tour="header-notifications"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
        className="hover:bg-subtle text-ink relative flex h-9 w-9 items-center justify-center rounded-md transition-colors"
      >
        <Bell aria-hidden="true" className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="bg-accent absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="menu"
          aria-label="Notifications"
          className="border-hairline bg-surface absolute top-11 right-0 z-40 w-80 overflow-hidden rounded-lg border shadow-[var(--shadow-lg)]"
        >
          <div className="border-hairline flex items-center justify-between border-b px-4 py-2.5">
            <p className="font-heading text-card-title text-ink font-semibold">Notifications</p>
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-body-xs text-link font-medium hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 && (
              <p className="text-muted px-4 py-6 text-center text-[var(--fs-body-xs)]">
                You&apos;re all caught up.
              </p>
            )}
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={cn(
                  "border-hairline flex items-start gap-3 border-b px-4 py-3 last:border-b-0",
                  !notification.read && "bg-accent/5",
                )}
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={notification.linkUrl || "/notifications"}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "text-data hover:text-ink block truncate",
                      notification.read ? "text-ink font-medium" : "text-ink font-semibold",
                    )}
                  >
                    {notification.title}
                  </Link>
                  {notification.body && (
                    <p className="text-data-xs text-muted mt-0.5 line-clamp-2">
                      {notification.body}
                    </p>
                  )}
                  <p className="font-ui text-data-xs text-faint mt-1 tracking-[var(--tracking-ui)] uppercase">
                    {notification.type.replace(/_/g, " ")} · {notification.createdAt}
                  </p>
                </div>
                {!notification.read && (
                  <button
                    type="button"
                    aria-label={`Mark "${notification.title}" as read`}
                    disabled={busyId === notification.id}
                    onClick={() => markRead(notification.id)}
                    className="hover:bg-subtle border-hairline text-faint hover:text-ink mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors"
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
