import { redirect } from "next/navigation";

import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";
import { getAuthContext } from "@/lib/auth/guards";

export const metadata = { title: "Set your password" };

/**
 * Password screen. Two situations share it:
 *
 *  - mid-onboarding, where a temporary password must be replaced before
 *    anything else is reachable (a restricted session), and
 *  - an active user changing their password from the account menu.
 *
 * Both verify the current password server-side and end with every session
 * revoked, so the user signs in again with the new password.
 */
export default async function ChangePasswordPage() {
  const context = await getAuthContext();
  if (!context) redirect("/sign-in");

  return (
    <div className="flex flex-col gap-8">
      <ChangePasswordForm
        email={context.user.email}
        required={context.session.mustChangePassword === true}
      />
    </div>
  );
}
