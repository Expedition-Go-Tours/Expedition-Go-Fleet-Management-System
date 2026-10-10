"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";

/**
 * Lifecycle action buttons. Each button posts { action } to the entity's
 * status endpoint; the server enforces permission + state validity. Actions
 * with a confirmation prompt open a labelled dialog (never window.confirm).
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
  const [pending, setPending] = useState<string | null>(null);

  async function run(action: string) {
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

  function request(action: string) {
    const prompt = confirm?.[action];
    if (prompt) setPending(action);
    else void run(action);
  }

  const pendingAction = actions.find((a) => a.action === pending);
  const pendingPrompt = pending ? confirm?.[pending] : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((item) => (
          <Button
            key={item.action}
            size="sm"
            variant={item.variant ?? "outline"}
            disabled={busy !== null}
            isLoading={busy === item.action}
            onClick={() => request(item.action)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-body-xs text-error">
          {error}
        </p>
      )}

      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pendingAction ? `Confirm ${pendingAction.label.toLowerCase()}` : "Confirm"}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant={(pendingAction?.variant as "primary" | "outline" | "accent") ?? "primary"}
              size="sm"
              isLoading={busy === pending}
              onClick={() => pending && void run(pending)}
            >
              {pendingAction?.label ?? "Confirm"}
            </Button>
          </>
        }
      >
        {pendingPrompt && <p className="text-body-sm text-ink">{pendingPrompt}</p>}
        {error && (
          <p role="alert" className="bg-error/10 text-body-xs mt-3 rounded-md border border-error/25 p-3 text-error">
            {error}
          </p>
        )}
      </Modal>
    </div>
  );
}