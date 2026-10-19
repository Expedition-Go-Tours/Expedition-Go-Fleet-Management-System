"use client";

import { signInWithEmailAndPassword } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { api } from "@/lib/client/api";
import { getFirebaseClientAuth } from "@/lib/firebase/client";

/**
 * Password change — used both for invited users (temporary password → chosen
 * password) and for active users changing their password from the account menu.
 *
 * The current password is proven against the server, the new one is applied,
 * every session is revoked, and we then re-authenticate with the new
 * credentials to obtain a fresh session.
 */
export function ChangePasswordForm({
  email,
  required = false,
}: {
  email: string;
  /** True when this is the blocked mid-onboarding screen. */
  required?: boolean;
}) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must differ from the current one.");
      return;
    }

    setBusy(true);
    try {
      await api.post("/api/v1/auth/password", { currentPassword, newPassword });

      // The password change revoked every session — sign in again with the new
      // credentials to continue.
      const auth = getFirebaseClientAuth();
      const credential = await signInWithEmailAndPassword(auth, email, newPassword);
      const idToken = await credential.user.getIdToken();
      await fetch("/api/v1/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password change failed.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <p className="text-on-dark/70 text-body-sm">
        {required
          ? "You signed in with a temporary password. Choose your own to finish setting up your account — you'll stay signed in."
          : "Enter your current password, then choose a new one. You'll sign in again with the new password."}
      </p>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="current"
          className="font-ui text-on-dark/60 text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase"
        >
          {required ? "Temporary password" : "Current password"}
        </label>
        <input
          id="current"
          type="password"
          required
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="border-on-dark-line bg-panel-1 text-on-dark focus:border-accent h-12 w-full rounded-md border px-4 transition-colors outline-none"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="new"
          className="font-ui text-on-dark/60 text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase"
        >
          New password
        </label>
        <input
          id="new"
          type="password"
          required
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="border-on-dark-line bg-panel-1 text-on-dark focus:border-accent h-12 w-full rounded-md border px-4 transition-colors outline-none"
        />
        <span className="font-ui text-on-dark/40 text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
          12+ chars, mixed case, digit &amp; symbol
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="confirm"
          className="font-ui text-on-dark/60 text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase"
        >
          Confirm new password
        </label>
        <input
          id="confirm"
          type="password"
          required
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="border-on-dark-line bg-panel-1 text-on-dark focus:border-accent h-12 w-full rounded-md border px-4 transition-colors outline-none"
        />
      </div>

      {error && (
        <p role="alert" className="text-body-xs text-accent">
          {error}
        </p>
      )}

      <Button variant="inverse" size="lg" type="submit" disabled={busy}>
        {busy ? "Setting password…" : "Set password & continue"}
      </Button>
    </form>
  );
}
