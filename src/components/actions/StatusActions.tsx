"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { api } from "@/lib/client/api";

/**
 * Lifecycle action buttons. Each button posts { action } to the entity's
 * status endpoint; the server enforces permission + state validity.
 */
export function StatusActions({
  endpoint,
  actions,
  confirm,
}: {
  /** e.g. "/api/v1/vehicles/abc/status" */
  endpoint: string;
  actions: { action: string; label: string; variant?: "primary" | "outline" | "accent" }[];
  /** Optional confirmation prompt per action (e.g. archiving). */
  confirm?: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: string) {
    const prompt = confirm?.[action];
    if (prompt && !window.confirm(prompt)) return;

    setBusy(action);
    setError(null);
    try {
      await api.post(endpoint, { action });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((item) => (
          <Button
            key={item.action}
            size="sm"
            variant={item.variant ?? "outline"}
            disabled={busy !== null}
            onClick={() => run(item.action)}
          >
            {busy === item.action ? "…" : item.label}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-body-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}
