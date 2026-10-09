import { redirect } from "next/navigation";

import { SignInForm } from "@/components/auth/SignInForm";
import { getAuthContext } from "@/lib/auth/guards";

export const metadata = { title: "Sign in" };

export default async function SignInPage() {
  // Already signed in? Straight to the app.
  const context = await getAuthContext();
  if (context && !context.session.mustChangePassword) redirect("/");
  if (context?.session.mustChangePassword) redirect("/change-password");

  return (
    <div className="flex flex-col gap-8">
      <p className="text-on-dark/70 text-body-sm">
        Sign in with the account your administrator set up for you.
      </p>
      <SignInForm />
    </div>
  );
}
