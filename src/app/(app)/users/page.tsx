import { UserPlus, Users } from "lucide-react";

import { InviteUserForm } from "@/components/admin/InviteUserForm";
import { UserDirectory } from "@/components/admin/UserDirectory";
import { Container } from "@/components/layout/Container";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS, permissionsForRoles } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/format";
import { countUsers, listUsers } from "@/lib/repos/users";

export const metadata = { title: "Users" };

/**
 * Employee directory. Filtering (by role, status or name) is presentation —
 * every action posts to its own permission-checked endpoint, so a manager who
 * can read this list still cannot change roles or edit a record.
 */
export default async function UsersPage() {
  const context = await requirePagePermission(PERMISSIONS.USER_READ);
  const permissions = [...permissionsForRoles(context.user.roles)];
  const canInvite = permissions.includes(PERMISSIONS.USER_INVITE);
  const canAssignRoles = permissions.includes(PERMISSIONS.USER_ROLE_ASSIGN);
  const canDisable = permissions.includes(PERMISSIONS.USER_DISABLE);
  const canUpdate = permissions.includes(PERMISSIONS.USER_UPDATE);

  const [users, userTotal] = await Promise.all([listUsers(), countUsers()]);

  const rows = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    status: user.status,
    roles: user.roles,
    lastLogin: formatDateTime(user.lastLoginAt),
  }));

  return (
    <Container className="flex flex-col gap-8 py-10">
      <PageHeader
        title="Users"
        description="Every employee account and its roles. Filter by role to see just drivers, then edit a record in place when you need to correct it for them."
        crumbs={[{ label: "Administration" }, { label: "Users" }]}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card
            flush
            dataTour="admin-users"
            icon={Users}
            title={`${userTotal} employee account${userTotal === 1 ? "" : "s"}`}
            description={
              userTotal > rows.length ? `Showing ${rows.length} most recently created` : undefined
            }
          >
            <UserDirectory
              users={rows}
              currentUserId={context.user.id}
              canAssignRoles={canAssignRoles}
              canDisable={canDisable}
              canUpdate={canUpdate}
            />
          </Card>
        </div>

        {canInvite && (
          <Card title="Invite user" icon={UserPlus} dataTour="admin-invite">
            <div className="p-5">
              <p className="text-body-xs text-muted mb-4">
                You&apos;ll receive a temporary password to share with the invitee directly
                (phone/WhatsApp). They must change it on first sign-in.
              </p>
              <InviteUserForm />
            </div>
          </Card>
        )}
      </div>
    </Container>
  );
}
