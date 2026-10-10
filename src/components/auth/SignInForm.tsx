"use client";

import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { getFirebaseClientAuth } from "@/lib/firebase/client";

/**
 * Map a Firebase Auth failure onto a message that tells the user what actually
 * happened. Browser SDK errors carry a `code` (e.g. auth/invalid-credential);
 * without this, every rejection — wrong password included — was reported as
 * "could not reach the service", which is misleading and sends users to the
 * wrong fix.
 */
function signInErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-login-credentials":
      return "Incorrect email or password.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact your administrator.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a moment and try again.";
    case "auth/network-request-failed":
    case "auth/timeout":
      return "Could not reach the authentication service. Check your connection and try again.";
    default:
      return "Sign-in failed. Contact your administrator.";
  }
}

/**
 * Sign-in form.
 *
 * The Firebase client SDK is used **only** to authenticate — the resulting ID
 * token is exchanged for our opaque server session, then the Firebase browser
 * auth state is discarded (the cookie session is authoritative).
 */
export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const auth = getFirebaseClientAuth();
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const idToken = await credential.user.getIdToken();

      const res = await fetch("/api/v1/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        // Discard the Firebase auth state so nothing lingers after a refusal.
        await signOut(auth).catch(() => {});
        setError(data?.error?.message ?? "Sign-in failed. Contact your administrator.");
        return;
      }

      if (data?.passwordChangeRequired) {
        router.replace("/change-password");
      } else {
        router.replace("/");
      }
      router.refresh();
    } catch (error) {
      setError(signInErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label
          htmlFor="email"
          className="font-ui text-on-dark/60 text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase"
        >
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border-on-dark-line bg-panel-1 text-on-dark focus:border-accent h-12 w-full rounded-md border px-4 transition-colors outline-none"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="password"
          className="font-ui text-on-dark/60 text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase"
        >
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border-on-dark-line bg-panel-1 text-on-dark focus:border-accent h-12 w-full rounded-md border px-4 transition-colors outline-none"
        />
      </div>

      {error && (
        <p role="alert" className="text-body-xs text-error">
          {error}
        </p>
      )}

      <Button variant="inverse" size="lg" type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
