"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { PublicUser } from "@/lib/auth/types";

interface NavItem {
  href: string;
  label: string;
  /** Hidden when the user lacks this permission. */
  permission?: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/vehicles", label: "Vehicles", permission: "vehicle:read" },
  { href: "/reports", label: "Reports", permission: "report:read:own" },
  { href: "/work-orders", label: "Work orders", permission: "work_order:read" },
  { href: "/expenses", label: "Expenses", permission: "expense:read" },
  { href: "/users", label: "Users", permission: "user:read" },
  { href: "/audit", label: "Audit", permission: "audit:read" },
];

export function AppShell({
  user,
  permissions,
  children,
}: {
  user: PublicUser;
  permissions: string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.permission || permissions.includes(item.permission),
  );

  async function signOut() {
    await fetch("/api/v1/auth/logout", {
      method: "POST",
      headers: { "x-csrf-token": readCsrf() },
    }).catch(() => {});
    // Full navigation (not router.push) so all client caches are discarded.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/sign-in");
  }

  function readCsrf(): string {
    const match = document.cookie.match(/(?:^|;\s*)(?:__Host-)?egt_csrf=([^;]+)/);
    return match ? decodeURIComponent(match[1]!) : "";
  }

  const nav = (
    <nav className="flex flex-col gap-1">
      {visibleItems.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setNavOpen(false)}
            className={cn(
              "font-ui rounded-md px-3 py-2 text-[length:var(--fs-ui-sm)] tracking-[var(--tracking-ui)] uppercase transition-colors",
              active
                ? "bg-panel-2 text-on-dark"
                : "text-on-dark/50 hover:bg-panel-1 hover:text-on-dark",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="bg-dark text-on-dark hidden w-60 shrink-0 flex-col justify-between p-5 lg:flex">
        <div className="flex flex-col gap-8">
          <Link href="/" className="font-heading text-heading-sm font-semibold">
            Expedition Go
            <span className="text-accent">.</span>
          </Link>
          {nav}
        </div>
        <div className="flex flex-col gap-3">
          <div className="border-on-dark-line border-t pt-4">
            <p className="text-body-xs font-medium">{user.name}</p>
            <p className="font-ui text-on-dark/40 text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
              {user.roles.join(" · ")}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            className="text-on-dark/60 justify-start"
          >
            Sign out
          </Button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="bg-dark text-on-dark flex w-full flex-col lg:hidden">
        <div className="flex items-center justify-between p-4">
          <Link href="/" className="font-heading text-heading-sm font-semibold">
            Expedition Go<span className="text-accent">.</span>
          </Link>
          <button
            type="button"
            onClick={() => setNavOpen((v) => !v)}
            className="font-ui text-on-dark/70 text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase"
          >
            {navOpen ? "Close" : "Menu"}
          </button>
        </div>
        {navOpen && (
          <div className="border-on-dark-line flex flex-col gap-4 border-t p-4">
            {nav}
            <div className="border-on-dark-line border-t pt-4">
              <p className="text-body-xs font-medium">{user.name}</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={signOut}
                className="text-on-dark/60 mt-2 justify-start"
              >
                Sign out
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <main className="flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
