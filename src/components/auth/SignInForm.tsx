"use client";

import { signInWithEmailAndPassword, signOut, type MultiFactorResolver } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { getFirebaseClientAuth } from "@/lib/firebase/client";
import { completeTotpSignIn, factorHints, toMultiFactorResolver } from "@/lib/firebase/mfa";

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
    case "auth/invalid-verification-code":
      return "That code is not correct. Check your app and try again.";
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
 *
 * Two-factor users get a second screen: the password alone raises
 * `auth/multi-factor-auth-required`, we keep the resolver, ask for the
 * authenticator code, and finish signing in with it. The server checks the
 * `sign_in_second_factor` claim on the resulting token.
 */
export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [resolver, setResolver] = useState<MultiFactorResolver | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Exchange a signed-in Firebase user for our opaque server session. */
  async function establishSession(idToken: string): Promise<void> {
    const res = await fetch("/api/v1/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      // Discard the Firebase auth state so nothing lingers after a refusal.
      await signOut(getFirebaseClientAuth()).catch(() => {});
      setError(data?.error?.message ?? "Sign-in failed. Contact your administrator.");
      return;
    }

    if (data?.passwordChangeRequired) {
      router.replace("/change-password");
    } else if (data?.mfaEnrollmentRequired) {
      // Privileged account with no second factor yet — go set one up.
      router.replace("/account");
    } else {
      router.replace("/");
    }
    router.refresh();
  }

  async function onSubmitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const auth = getFirebaseClientAuth();
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      await establishSession(await credential.user.getIdToken());
    } catch (caught) {
      const mfaResolver = toMultiFactorResolver(getFirebaseClientAuth(), caught);
      if (mfaResolver) {
        // Password was right — only the second factor is missing.
        setResolver(mfaResolver);
        setMfaCode("");
      } else {
        setError(signInErrorMessage(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resolver) return;
    setError(null);
    setBusy(true);
    try {
      const hints = factorHints(resolver);
      const enrollmentId = hints[0]?.uid;
      if (!enrollmentId) {
        setError("No two-factor method is enrolled. Contact your administrator.");
        return;
      }
      const user = await completeTotpSignIn(resolver, enrollmentId, mfaCode.trim());
      await establishSession(await user.getIdToken());
    } catch (caught) {
      setError(signInErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "border-on-dark-line bg-panel-1 text-on-dark focus:border-accent h-12 w-full rounded-md border px-4 transition-colors outline-none";
  const labelClass =
    "font-ui text-on-dark/60 text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase";

  if (resolver) {
    return (
      <form onSubmit={onSubmitMfa} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className={labelClass}>Two-factor authentication</span>
          <p className="text-on-dark/70 text-body-sm">
            Open your authenticator app and enter the 6-digit code for this account.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="mfa-code" className={labelClass}>
            Authentication code
          </label>
          <input
            id="mfa-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            required
            autoComplete="one-time-code"
            placeholder="123456"
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
            className={inputClass}
          />
        </div>

        {error && (
          <p role="alert" className="text-body-xs text-error">
            {error}
          </p>
        )}

        <Button variant="inverse" size="lg" type="submit" disabled={busy}>
          {busy ? "Verifying…" : "Verify"}
        </Button>

        <button
          type="button"
          className="text-on-dark/50 text-body-xs hover:text-on-dark underline underline-offset-2"
          onClick={() => {
            setResolver(null);
            setError(null);
            setMfaCode("");
          }}
        >
          Back to sign in
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmitCredentials} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className={labelClass}>
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="password" className={labelClass}>
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
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
