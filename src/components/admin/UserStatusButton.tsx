"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { api } from "@/lib/client/api";

/** Disable/enable a user account (user:disable). */
export function UserStatusButton({ userId, disabled }: { userId: string; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const prompt = disabled
      ? "Re-enable this account?"
      : "Disable this account? All their sessions will be revoked.";
    if (!window.confirm(prompt)) return;

    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/users/${userId}/${disabled ? "enable" : "disable"}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        size="sm"
        variant={disabled ? "outline" : "ghost"}
        disabled={busy}
        onClick={run}
        className={disabled ? "" : "text-error"}
      >
        {busy ? "…" : disabled ? "Enable" : "Disable"}
      </Button>
      {error && (
        <p role="alert" className="text-body-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}
