import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  CalendarClock,
  Car,
  Fuel,
  LayoutDashboard,
  ReceiptText,
  ScrollText,
  ShieldAlert,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";

/*
 * Sidebar navigation definition. Items are permission-gated server-side
 * (hiding a button is presentation; every route still enforces its own
 * authorization). `anyOf` shows the item when at least one permission holds.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
  anyOf?: string[];
  /** Show only when the user has NONE of these (e.g. workspace for managers). */
  hideWhen?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      {
        href: "/workspace",
        label: "Driver workspace",
        icon: UserRound,
        anyOf: ["report:create", "assignment:read"],
      },
    ],
  },
  {
    label: "Fleet",
    items: [
      { href: "/vehicles", label: "Vehicles", icon: Car, permission: "vehicle:read" },
      { href: "/reports", label: "Issues", icon: AlertTriangle, permission: "report:read:own" },
      { href: "/work-orders", label: "Work orders", icon: Wrench, permission: "work_order:read" },
      {
        href: "/maintenance",
        label: "Maintenance",
        icon: CalendarClock,
        permission: "schedule:read",
      },
    ],
  },
  {
    label: "Finance & compliance",
    items: [
      { href: "/expenses", label: "Expenses", icon: ReceiptText, permission: "expense:read" },
      { href: "/fuel", label: "Fuel", icon: Fuel, permission: "fuel:read" },
      {
        href: "/incidents",
        label: "Incidents",
        icon: ShieldAlert,
        anyOf: ["incident:create", "incident:read:all"],
      },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/users", label: "Users", icon: Users, permission: "user:read" },
      { href: "/audit", label: "Audit log", icon: ScrollText, permission: "audit:read" },
    ],
  },
];

export function visibleNavGroups(permissions: string[]): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.hideWhen?.some((p) => permissions.includes(p))) return false;
      if (item.anyOf) return item.anyOf.some((p) => permissions.includes(p));
      return !item.permission || permissions.includes(item.permission);
    }),
  })).filter((group) => group.items.length > 0);
}