"use client";

import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { getFirebaseClientAuth } from "@/lib/firebase/client";

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
    } catch {
      setError("Could not reach the authentication service. Try again.");
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
        <p role="alert" className="text-body-xs text-accent">
          {error}
        </p>
      )}

      <Button variant="inverse" size="lg" type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
