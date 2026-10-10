import { UserPlus, Users } from "lucide-react";

import { RoleEditor } from "@/components/admin/RoleEditor";
import { UserStatusButton } from "@/components/admin/UserStatusButton";
import { InviteUserForm } from "@/components/admin/InviteUserForm";
import { Container } from "@/components/layout/Container";
import { Card } from "@/components/ui/Card";
import { DisplayTitle } from "@/components/ui/DisplayTitle";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requireAuthContext } from "@/lib/auth/guards";
import { PERMISSIONS, permissionsForRoles } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/format";
import { listUsers } from "@/lib/repos/users";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const context = await requireAuthContext();
  const permissions = [...permissionsForRoles(context.user.roles)];
  const canInvite = permissions.includes(PERMISSIONS.USER_INVITE);
  const canAssignRoles = permissions.includes(PERMISSIONS.USER_ROLE_ASSIGN);
  const canDisable = permissions.includes(PERMISSIONS.USER_DISABLE);

  const users = await listUsers();

  return (
    <Container className="flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-2">
        <Eyebrow>Administration</Eyebrow>
        <DisplayTitle size="md">Users</DisplayTitle>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card title={`${users.length} user(s)`} icon={Users}>
            <ul className="divide-hairline divide-y">
              {users.map((user) => (
                <li key={user.id} className="flex flex-col gap-3 px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="text-body-sm font-medium">{user.name}</span>
                      <span className="text-body-xs text-muted">{user.email}</span>
                      <span className="text-body-xs text-muted">
                        Last login: {formatDate(user.lastLoginAt)}
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

                  {canDisable && user.id !== context.user.id && (
                    <UserStatusButton userId={user.id} disabled={user.status === "DISABLED"} />
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {canInvite && (
          <Card title="Invite user" icon={UserPlus}>
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
