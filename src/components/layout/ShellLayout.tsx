"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";

import { NAV_GROUPS, navTourId } from "@/components/layout/nav";
import { HelpMenu } from "@/components/onboarding/HelpMenu";
import {
  NotificationBell,
  type BellNotification,
} from "@/components/notifications/NotificationBell";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/cn";

export interface ShellUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
}

const COLLAPSE_KEY = "egt-sidebar-collapsed";

function isActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ShellLayout({
  user,
  visibleHrefs,
  unreadCount,
  notifications,
  children,
}: {
  user: ShellUser;
  visibleHrefs: string[];
  unreadCount: number;
  notifications: BellNotification[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const mobileDrawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  // Close the user menu on outside click or Escape, mirroring NotificationBell.
  useEffect(() => {
    if (!userMenuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [userMenuOpen]);

  // Close the mobile navigation drawer on Escape and trap focus inside it,
  // matching the modal behaviour used everywhere else in the app.
  useEffect(() => {
    if (!mobileOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    mobileDrawerRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileOpen(false);
        return;
      }
      if (event.key === "Tab") {
        const drawer = mobileDrawerRef.current;
        if (!drawer) return;
        const focusables = drawer.querySelectorAll<HTMLElement>(
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
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [mobileOpen]);

  async function signOut() {
    await fetch("/api/v1/auth/logout", {
      method: "POST",
      headers: { "x-csrf-token": readCsrf() },
    }).catch(() => {});
    // Full navigation so all client caches for the old session are discarded.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/sign-in");
  }

  function readCsrf(): string {
    const match = document.cookie.match(/(?:^|;\s*)(?:__Host-)?egt_csrf=([^;]+)/);
    return match ? decodeURIComponent(match[1]!) : "";
  }

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => visibleHrefs.includes(item.href)),
  })).filter((group) => group.items.length > 0);

  // Sidebar widths correspond to --sidebar-w (15.5rem) declared in tokens.css.
  const sideWidth = collapsed ? "w-[68px]" : "w-[15.5rem]";

  function renderNav(innerCollapsed: boolean, onNavigate?: () => void) {
    return (
      <nav aria-label="Main" className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 pt-2 pb-4">
        {groups.map((group) => (
          <div key={group.label}>
            {!innerCollapsed && (
              <p className="font-ui text-on-dark-muted px-3 pb-1.5 text-[10px] font-semibold tracking-[var(--tracking-ui)] uppercase">
                {group.label}
              </p>
            )}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href, pathname);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      data-tour={navTourId(item.href)}
                      title={innerCollapsed ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-offset-0",
                        innerCollapsed && "justify-center px-0",
                        active
                          ? "bg-white/10 font-semibold text-white"
                          : "text-on-dark-muted hover:bg-white/5 hover:text-white",
                      )}
                    >
                      <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
                      {!innerCollapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    );
  }

  const brand = (
    <div className={cn("flex items-center gap-2.5 px-3 py-4", collapsed && "lg:justify-center")}>
      <Image
        src="/lite-logo.png"
        alt="Expedition Go Tours"
        width={32}
        height={32}
        priority
        className="h-8 w-8 shrink-0 rounded-md bg-white object-contain"
      />
      {!collapsed && (
        <span className="flex min-w-0 flex-col">
          <span className="font-heading truncate text-sm font-semibold text-white">
            Expedition Go Tours
          </span>
          <span className="font-ui text-on-dark-muted text-[10px] tracking-[var(--tracking-ui)] uppercase">
            Fleet operations
          </span>
        </span>
      )}
    </div>
  );

  return (
    <div className="min-h-full">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            tabIndex={-1}
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/50"
          />
          <div
            ref={mobileDrawerRef}
            tabIndex={-1}
            className="bg-panel-1 absolute inset-y-0 left-0 flex w-72 flex-col shadow-[var(--shadow-lg)] outline-none"
          >
            <div className="flex items-center justify-between pr-2">
              {brand}
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                className="text-on-dark-muted p-2 hover:text-white"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
            {renderNav(false, () => setMobileOpen(false))}
            <UserIdentity
              user={user}
              className="border-t border-white/10 px-4 py-3"
              onSignOut={signOut}
            />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "bg-panel-1 fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-white/10 transition-[width] duration-200 lg:flex",
          sideWidth,
        )}
      >
        {brand}
        {renderNav(collapsed)}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="text-on-dark-muted flex items-center justify-center gap-2 border-t border-white/10 py-3 text-xs hover:bg-white/5 hover:text-white"
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden="true" className="h-4 w-4" />
          ) : (
            <>
              <PanelLeftClose aria-hidden="true" className="h-4 w-4" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </aside>

      {/* Top header — offset by the fixed sidebar so the search bar isn't hidden underneath it. */}
      <header
        className={cn(
          "border-hairline bg-surface sticky top-0 z-20 border-b transition-[padding] duration-200",
          // pl values mirror --sidebar-w from tokens.css
          collapsed ? "lg:pl-[68px]" : "lg:pl-[15.5rem]",
        )}
      >
        <div className="flex h-[var(--topbar-h)] items-center gap-3 px-4 lg:px-6">
          <button
            type="button"
            data-tour="nav-mobile-menu"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            className="hover:bg-subtle rounded-md p-2 lg:hidden"
          >
            <Menu aria-hidden="true" className="h-5 w-5" />
          </button>

          <div className="hidden max-w-md flex-1 md:block">
            <GlobalSearch />
          </div>
          <div className="flex-1 md:hidden" />

          <div className="ml-auto flex items-center gap-1.5">
            <div className="md:hidden">
              <GlobalSearch enableHotkey={false} />
            </div>
            <HelpMenu />
            <NotificationBell notifications={notifications} unreadCount={unreadCount} />
            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                data-tour="header-account"
                onClick={() => setUserMenuOpen((o) => !o)}
                aria-label="Account menu"
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                className="hover:bg-subtle flex items-center gap-2 rounded-md p-1.5 transition-colors"
              >
                <Avatar name={user.name} tone="dark" />
                <span className="hidden text-left leading-tight xl:block">
                  <span className="text-data text-ink block font-semibold">{user.name}</span>
                  <span className="font-ui text-muted text-[10px] tracking-[var(--tracking-ui)] uppercase">
                    {user.roles.join(" · ").toLowerCase()}
                  </span>
                </span>
              </button>
              {userMenuOpen && (
                <div
                  role="menu"
                  aria-label="Account"
                  className="border-hairline bg-surface absolute top-11 right-0 z-40 w-56 overflow-hidden rounded-lg border shadow-[var(--shadow-lg)]"
                >
                  <div className="border-hairline bg-subtle border-b px-4 py-3">
                    <p className="text-data text-ink truncate font-semibold">{user.name}</p>
                    <p className="text-data-xs text-muted truncate">{user.email}</p>
                  </div>
                  <Link
                    href="/change-password"
                    onClick={() => setUserMenuOpen(false)}
                    className="text-data hover:bg-subtle text-ink block px-4 py-2.5"
                  >
                    Change password
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={signOut}
                    className="hover:bg-subtle text-data text-error flex w-full items-center gap-2 px-4 py-2.5"
                  >
                    <LogOut aria-hidden="true" className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <div
        className={cn(
          "transition-[padding] duration-200",
          // pl values mirror --sidebar-w from tokens.css
          collapsed ? "lg:pl-[68px]" : "lg:pl-[15.5rem]",
        )}
      >
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1440px] px-4 py-6 outline-none lg:px-6 lg:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

function UserIdentity({
  user,
  className,
  onSignOut,
}: {
  user: ShellUser;
  className?: string;
  onSignOut: () => void;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Avatar name={user.name} tone="dark" />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="text-data block truncate font-semibold text-white">{user.name}</span>
        <span className="font-ui text-on-dark-muted text-[10px] tracking-[var(--tracking-ui)] uppercase">
          {user.roles.join(" · ").toLowerCase()}
        </span>
      </span>
      <button
        type="button"
        onClick={onSignOut}
        aria-label="Sign out"
        className="text-on-dark-muted rounded-md p-2 hover:bg-white/10 hover:text-white"
      >
        <LogOut aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}
