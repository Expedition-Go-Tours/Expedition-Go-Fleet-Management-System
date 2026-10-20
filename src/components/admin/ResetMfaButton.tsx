"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";

/**
 * Account recovery: remove a user's second factor so they can set up a new one
 * (user:update).
 *
 * This exists because TOTP enrollment is client-side only — a lost
 * authenticator app cannot be re-issued, the factor has to be cleared and
 * enrolled again. Weakening an account is a deliberate act, so it takes a
 * reason and is written to the audit log.
 */
export function ResetMfaButton({ userId, userName }: { userId: string; userName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    try {
      await api.post(`/api/v1/users/${userId}/mfa/reset`, { reason });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset two-factor authentication");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Reset 2FA
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Reset two-factor authentication"
        description={`${userName} will sign in with just a password until they set up an authenticator app again.`}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="accent" type="submit" form="reset-mfa-form" isLoading={busy}>
              Reset it
            </Button>
          </>
        }
      >
        <form id="reset-mfa-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          <p className="text-body-xs text-muted">
            Use this when someone has lost their phone or authenticator app. It removes their
            current second factor — it does not set a new one. This is recorded in the audit log
            with your name.
          </p>

          {error && (
            <p
              role="alert"
              className="bg-error/10 border-error/25 text-error text-body-xs rounded-md border p-3"
            >
              {error}
            </p>
          )}

          <Field label="Reason" required htmlFor="reset-mfa-reason">
            <Textarea
              id="reset-mfa-reason"
              name="reason"
              rows={2}
              required
              placeholder="e.g. Lost phone at Cape Coast, verified by ID at the office"
            />
          </Field>
        </form>
      </Modal>
    </>
  );
}
