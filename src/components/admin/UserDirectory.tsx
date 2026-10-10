"use client";

import { useMemo, useState } from "react";
import { Search, Users } from "lucide-react";

import { EditUserDialog } from "@/components/admin/EditUserDialog";
import { RoleEditor } from "@/components/admin/RoleEditor";
import { UserStatusButton } from "@/components/admin/UserStatusButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Select, Input } from "@/components/ui/fields";
import { USER_STATUSES, ROLE_KEYS, type RoleKey, type UserStatus } from "@/lib/auth/types";

/** Plain, serializable employee row handed down from the server page. */
export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  status: UserStatus;
  roles: RoleKey[];
  lastLogin?: string;
}

/**
 * Employee directory: search, filter by role or status, then act.
 *
 * Built for the administrator who needs to find one driver (or every driver)
 * quickly and correct their record in place. Filtering is presentation only —
 * every action still posts to its own permission-checked endpoint.
 */
export function UserDirectory({
  users,
  currentUserId,
  canAssignRoles,
  canDisable,
  canUpdate,
}: {
  users: DirectoryUser[];
  currentUserId: string;
  canAssignRoles: boolean;
  canDisable: boolean;
  canUpdate: boolean;
}) {
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== "ALL" && !user.roles.includes(roleFilter as RoleKey)) return false;
      if (statusFilter !== "ALL" && user.status !== statusFilter) return false;
      if (needle && !`${user.name} ${user.email}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [users, roleFilter, statusFilter, query]);

  const hasFilters = roleFilter !== "ALL" || statusFilter !== "ALL" || query.trim() !== "";

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-tour="admin-user-filters">
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Search</span>
          <span className="relative flex items-center">
            <Search aria-hidden="true" className="text-faint absolute left-3 h-4 w-4" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name or email"
              className="pl-9"
            />
          </span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Role</span>
          <Select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="ALL">All roles</option>
            {ROLE_KEYS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Status</span>
          <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="ALL">All statuses</option>
            {USER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-xs text-muted">
          Showing {filtered.length} of {users.length} employee{users.length === 1 ? "" : "s"}
        </p>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setRoleFilter("ALL");
              setStatusFilter("ALL");
            }}
            className="text-body-xs text-link font-medium hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <Users aria-hidden="true" className="text-faint h-6 w-6" />
          <p className="text-body-sm text-ink">No employees match these filters</p>
          <p className="text-body-xs text-muted">Try clearing the role or status filter.</p>
        </div>
      ) : (
        <ul className="divide-hairline divide-y" data-tour="admin-user-list">
          {filtered.map((user) => (
            <li key={user.id} className="flex flex-col gap-3 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="text-body-sm font-medium">{user.name}</span>
                  <span className="text-body-xs text-muted break-all">{user.email}</span>
                  <span className="text-body-xs text-muted">
                    {user.phone ? `${user.phone} · ` : ""}Last login: {user.lastLogin ?? "never"}
                    {user.id === currentUserId ? " · you" : ""}
                  </span>
                </div>
                <StatusBadge status={user.status} />
              </div>

              {canAssignRoles ? (
                <RoleEditor userId={user.id} currentRoles={user.roles} />
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {user.roles.map((role) => (
                    <span
                      key={role}
                      className="border-hairline text-muted rounded-pill font-ui border px-2.5 py-0.5 text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase"
                    >
                      {role}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {canUpdate && <EditUserDialog user={user} />}
                {canDisable && user.id !== currentUserId && (
                  <UserStatusButton userId={user.id} disabled={user.status === "DISABLED"} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
