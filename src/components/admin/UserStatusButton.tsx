"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";

/** Disable/enable a user account (user:disable). */
export function UserStatusButton({ userId, disabled }: { userId: string; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/users/${userId}/${disabled ? "enable" : "disable"}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        size="sm"
        variant={disabled ? "outline" : "ghost"}
        disabled={busy}
        onClick={() => setConfirmOpen(true)}
        className={disabled ? "" : "text-error"}
      >
        {busy ? "…" : disabled ? "Enable" : "Disable"}
      </Button>
      {error && (
        <p role="alert" className="text-body-xs text-error">
          {error}
        </p>
      )}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={disabled ? "Re-enable account" : "Disable account"}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={disabled ? "primary" : "danger"}
              size="sm"
              disabled={busy}
              onClick={run}
            >
              {busy ? "Working…" : disabled ? "Enable" : "Disable"}
            </Button>
          </>
        }
      >
        <p className="text-body-sm text-muted">
          {disabled
            ? "The user will be able to sign in and access the system again."
            : "The user will be signed out immediately and all active sessions will be revoked."}
        </p>
      </Modal>
    </div>
  );
}
