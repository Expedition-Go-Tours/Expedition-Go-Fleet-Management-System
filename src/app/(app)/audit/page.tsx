import { Container } from "@/components/layout/Container";
import { Card } from "@/components/ui/Card";
import { DisplayTitle } from "@/components/ui/DisplayTitle";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requireAuthContext } from "@/lib/auth/guards";
import { PERMISSIONS, rolesHavePermission } from "@/lib/auth/permissions";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import { toDate } from "@/lib/repos/timestamps";
import { redirect } from "next/navigation";

export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  const context = await requireAuthContext();
  if (!rolesHavePermission(context.user.roles, PERMISSIONS.AUDIT_READ)) {
    redirect("/");
  }

  const snap = await getAdminDb().collection(COLLECTIONS.auditLogs).limit(200).get();

  const entries = snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        eventType: String(data.eventType ?? ""),
        actorId: data.actorId ? String(data.actorId) : null,
        entityType: data.entityType ? String(data.entityType) : null,
        entityId: data.entityId ? String(data.entityId) : null,
        reason: data.reason ? String(data.reason) : null,
        outcome: String(data.outcome ?? "SUCCESS"),
        createdAt: toDate(data.createdAt) ?? new Date(0),
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <Container className="flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-2">
        <Eyebrow>Compliance</Eyebrow>
        <DisplayTitle size="md">Audit log</DisplayTitle>
        <p className="text-body-xs text-muted">Last {entries.length} events (newest first).</p>
      </div>

      <Card>
        {entries.length === 0 ? (
          <p className="text-body-xs text-muted px-5 py-8">No audit events yet.</p>
        ) : (
          <ul className="divide-hairline divide-y">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-4 px-5 py-3">
                <div className="flex min-w-0 flex-col">
                  <span className="font-ui text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
                    {entry.eventType}
                  </span>
                  <span className="text-body-xs text-muted truncate">
                    {entry.entityType && `${entry.entityType} ${entry.entityId ?? ""}`}
                    {entry.reason && ` — ${entry.reason}`}
                  </span>
                  <span className="text-body-xs text-muted">
                    {entry.createdAt.toLocaleString("en-GB")}
                  </span>
                </div>
                <StatusBadge status={entry.outcome} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Container>
  );
}
