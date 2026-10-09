import { redirect } from "next/navigation";

import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";
import { getAuthContext } from "@/lib/auth/guards";

export const metadata = { title: "Set your password" };

export default async function ChangePasswordPage() {
  const context = await getAuthContext();
  if (!context) redirect("/sign-in");
  // A full session has nothing to change here.
  if (!context.session.mustChangePassword) redirect("/");

  return (
    <div className="flex flex-col gap-8">
      <ChangePasswordForm email={context.user.email} />
    </div>
  );
}
