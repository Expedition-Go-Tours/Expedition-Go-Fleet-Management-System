import { ShieldCheck } from "lucide-react";

import { MfaSettings } from "@/components/auth/MfaSettings";
import { Container } from "@/components/layout/Container";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireAuthContext } from "@/lib/auth/guards";
import { listEnrolledMfaFactors } from "@/lib/auth/mfa";

export const metadata = { title: "Account & security" };

/**
 * Account & security — two-factor authentication for your own account.
 *
 * Lives inside the app shell so it is a normal place to visit (and so the
 * guided tour can walk people around it). A privileged user who has not yet
 * set up a second factor is confined here by every other page until they do,
 * which is what `assertMfaEnrollmentComplete` enforces.
 *
 * Enrollment status is read from Firebase, which is authoritative — not from
 * the cached flag on the user record.
 */
export default async function AccountPage() {
  const context = await requireAuthContext();
  const factors = await listEnrolledMfaFactors(context.user.firebaseUid);

  return (
    <Container className="flex flex-col gap-8 py-10">
      <PageHeader
        title="Account & security"
        description="Two-factor authentication for your own account, and how to recover if you lose it."
        crumbs={[{ label: "Overview", href: "/" }, { label: "Account & security" }]}
        dataTour="account-header"
      />

      <Card title="Two-factor authentication" icon={ShieldCheck} dataTour="account-security">
        <div className="p-5">
          <MfaSettings
            email={context.user.email}
            mfaEnabled={factors.length > 0}
            mfaEnrollmentRequired={context.session.mfaEnrollmentRequired === true}
            factors={factors}
          />
        </div>
      </Card>
    </Container>
  );
}
