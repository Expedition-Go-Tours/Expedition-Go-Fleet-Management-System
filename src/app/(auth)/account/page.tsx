import { redirect } from "next/navigation";

import { MfaSettings } from "@/components/auth/MfaSettings";
import { getAuthContext } from "@/lib/auth/guards";
import { listEnrolledMfaFactors } from "@/lib/auth/mfa";

export const metadata = { title: "Account & security" };

/**
 * Account & security: two-factor authentication management.
 *
 * Lives in the `(auth)` group, deliberately outside the app shell — a user who
 * must enroll before continuing gets a focused screen here, and the app layout
 * redirects restricted sessions to this page. Enrollment status is read from
 * Firebase (authoritative), not from our cached flag.
 */
export default async function AccountPage() {
  const context = await getAuthContext();
  if (!context) redirect("/sign-in");

  const factors = await listEnrolledMfaFactors(context.user.firebaseUid);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="font-ui text-on-dark/60 text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
          Signed in as {context.user.email}
        </p>
        <h1 className="text-on-dark text-heading-md font-heading">Account &amp; security</h1>
      </div>

      <MfaSettings
        email={context.user.email}
        mfaEnabled={factors.length > 0}
        mfaEnrollmentRequired={context.session.mfaEnrollmentRequired === true}
        factors={factors}
      />
    </div>
  );
}
