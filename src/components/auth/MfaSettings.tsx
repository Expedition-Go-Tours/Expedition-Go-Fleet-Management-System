"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { signInWithEmailAndPassword, signOut, type User } from "firebase/auth";

import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/fields";
import { api } from "@/lib/client/api";
import { getFirebaseClientAuth } from "@/lib/firebase/client";
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  enrolledFactors,
  removeEnrolledFactor,
  type TotpSetup,
} from "@/lib/firebase/mfa";

/*
 * Two-factor (TOTP) management.
 *
 * A password is required before any change — the app does not keep a Firebase
 * session hanging around, so we re-authenticate to get the user object Firebase
 * needs, then sign straight back out. The TOTP secret is generated and verified
 * in the browser and never sent to our server; we only tell the server the
 * outcome so it can lift the enrollment-only session restriction.
 */

type Intent = "enroll" | "remove";

/** `otpauth://…` URIs open the authenticator app directly where one is linked. */
function groupKey(key: string): string {
  return key.replace(/(.{4})/g, "$1 ").trim();
}

export function MfaSettings({
  email,
  mfaEnabled,
  mfaEnrollmentRequired,
  factors,
}: {
  email: string;
  mfaEnabled: boolean;
  mfaEnrollmentRequired: boolean;
  factors: { id: string; displayName: string; enrolledOn: string }[];
}) {
  const router = useRouter();
  const [intent, setIntent] = useState<Intent | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function reset() {
    setIntent(null);
    setFirebaseUser(null);
    setSetup(null);
    setPassword("");
    setCode("");
    setBusy(false);
    setRemovingId(null);
    if (firebaseUser) {
      void signOut(getFirebaseClientAuth()).catch(() => {});
    }
  }

  /** Tell the server what is actually enrolled, then reload the page state. */
  async function syncServer(): Promise<void> {
    await api.post("/api/v1/account/mfa");
    router.refresh();
  }

  function authErrorMessage(error: unknown): string {
    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (errorCode === "auth/invalid-credential" || errorCode === "auth/wrong-password") {
      return "Incorrect password.";
    }
    if (errorCode === "auth/too-many-requests") {
      return "Too many attempts. Wait a moment and try again.";
    }
    return error instanceof Error && error.message
      ? error.message
      : "Could not complete that. Try again.";
  }

  /** Step 1: prove who they are. */
  async function onSubmitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const auth = getFirebaseClientAuth();
      const credential = await signInWithEmailAndPassword(auth, email, password);
      setFirebaseUser(credential.user);

      if (intent === "enroll") {
        const next = await beginTotpEnrollment(credential.user, email);
        setSetup(next);
      } else {
        const current = enrolledFactors(credential.user);
        for (const factor of current) {
          await removeEnrolledFactor(credential.user, factor.uid);
        }
        await signOut(auth).catch(() => {});
        await syncServer();
        setNotice("Two-factor authentication has been turned off.");
        reset();
      }
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /** Step 2 (enroll): prove they have the app before we count them as protected. */
  async function onSubmitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firebaseUser || !setup) return;
    setError(null);
    setBusy(true);
    try {
      await confirmTotpEnrollment(firebaseUser, setup.secret, code.trim());
      await signOut(getFirebaseClientAuth()).catch(() => {});
      await syncServer();
      setNotice("Two-factor authentication is on. You will need your app to sign in.");
      reset();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(factorId: string) {
    setError(null);
    setBusy(true);
    setRemovingId(factorId);
    try {
      const auth = getFirebaseClientAuth();
      const credential = await signInWithEmailAndPassword(auth, email, password);
      await removeEnrolledFactor(credential.user, factorId);
      await signOut(auth).catch(() => {});
      await syncServer();
      setNotice("That two-factor method has been removed.");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
      setRemovingId(null);
    }
  }

  // ── Enrolment wizard ──────────────────────────────────────────────────────
  if (intent && (setup || intent === "remove")) {
    return (
      <div className="flex flex-col gap-6">
        <p className="text-body-xs text-muted">
          {setup
            ? "Add this account to your authenticator app (Google Authenticator, Authy, 1Password…), then enter the code it shows."
            : "Confirm your password to change your two-factor settings."}
        </p>

        {setup && (
          <div className="border-hairline bg-subtle rounded-md border p-5">
            <p className="field-label">Secret key</p>
            <p className="bg-surface text-ink border-hairline mt-2 rounded-md border px-3 py-2 font-mono text-[0.85rem] break-all">
              {groupKey(setup.manualEntryKey)}
            </p>
            <p className="text-body-xs text-muted mt-3">
              Type this into your app, or{" "}
              <a
                href={setup.qrCodeUrl}
                className="text-link font-medium underline underline-offset-2"
                rel="noreferrer"
              >
                open it in your authenticator app
              </a>
              .
            </p>
          </div>
        )}

        <form onSubmit={setup ? onSubmitCode : onSubmitPassword} className="flex flex-col gap-5">
          {!setup && (
            <Field label="Confirm password" required htmlFor="mfa-password">
              <Input
                id="mfa-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}

          {setup && (
            <Field label="6-digit code" required htmlFor="mfa-code">
              <Input
                id="mfa-code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          )}

          {error && (
            <p
              role="alert"
              className="bg-error/10 border-error/25 text-error text-body-xs rounded-md border p-3"
            >
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button variant="accent" type="submit" disabled={busy}>
              {busy ? "Working…" : setup ? "Confirm and enable" : "Continue"}
            </Button>
            <Button variant="ghost" type="button" onClick={reset} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    );
  }

  // ── Status ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {mfaEnrollmentRequired && (
        <p
          role="alert"
          className="border-warning/30 bg-warning/10 text-warning text-body-xs rounded-md border p-4"
        >
          Your role handles money and account access, so two-factor authentication is required. Set
          it up below to continue into the app.
        </p>
      )}

      {notice && (
        <p
          role="status"
          className="border-success/30 bg-success/10 text-success text-body-xs rounded-md border p-4"
        >
          {notice}
        </p>
      )}

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-body-sm text-ink font-medium">
            {mfaEnabled ? "Two-factor authentication is on" : "Two-factor authentication is off"}
          </p>
          <p className="text-body-xs text-muted mt-1">
            {mfaEnabled
              ? "Signing in needs your password plus a code from your authenticator app."
              : "Anyone with your password can sign in."}
          </p>
        </div>
        <span
          className={`rounded-pill font-ui border px-3 py-1 text-[length:var(--fs-ui-xs)] uppercase ${
            mfaEnabled ? "border-success/30 text-success" : "border-warning/30 text-warning"
          }`}
        >
          {mfaEnabled ? "Protected" : "Not protected"}
        </span>
      </div>

      {factors.length > 0 && (
        <ul className="border-hairline divide-hairline divide-y rounded-md border">
          {factors.map((factor) => (
            <li key={factor.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-body-sm text-ink">{factor.displayName || "Authenticator app"}</p>
                <p className="text-data-xs text-muted">Added {factor.enrolledOn}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                disabled={busy}
                onClick={() => onRemove(factor.id)}
              >
                {removingId === factor.id ? "Removing…" : "Remove"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p
          role="alert"
          className="bg-error/10 border-error/25 text-error text-body-xs rounded-md border p-3"
        >
          {error}
        </p>
      )}

      <Field
        label="Confirm password to make a change"
        htmlFor="mfa-quick-password"
        hint="Required before anything on this page can be changed."
      >
        <Input
          id="mfa-quick-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      <div>
        {mfaEnabled ? (
          <Button
            variant="outline"
            type="button"
            disabled={busy}
            onClick={() => {
              setError(null);
              setNotice(null);
              setIntent("remove");
            }}
          >
            Turn two-factor off
          </Button>
        ) : (
          <Button
            variant="accent"
            type="button"
            disabled={busy}
            onClick={() => {
              setError(null);
              setNotice(null);
              setIntent("enroll");
            }}
          >
            Set up two-factor
          </Button>
        )}
      </div>
    </div>
  );
}
