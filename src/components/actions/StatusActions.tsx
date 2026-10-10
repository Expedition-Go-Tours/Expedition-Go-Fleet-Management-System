"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";

/**
 * Action-name → icon. Kept inside this client component so callers only pass
 * plain, serializable action objects across the server/client boundary
 * (Lucide components cannot be serialized).
 */
const ACTION_ICONS: Record<string, LucideIcon> = {
  // vehicles
  send_to_workshop: Wrench,
  return_to_service: CheckCircle2,
  safety_hold: ShieldAlert,
  release: Unlock,
  archive: Archive,
  // work orders
  start: Play,
  wait: AlertTriangle,
  resume: Play,
  verify: ClipboardCheck,
  close: ShieldCheck,
  reopen: RotateCcw,
  // reports / incidents
  triage: ClipboardCheck,
  start_review: ClipboardCheck,
  resolve: CheckCircle2,
  // expenses
  void: CircleDot,
};

/**
 * Lifecycle action buttons. Each button posts { action } (plus an optional
 * reason field) to the entity's status endpoint; the server enforces
 * permission + state validity. Actions with a confirmation and/or a reason
 * open a labelled dialog (never window.confirm).
 */
export function StatusActions({
  endpoint,
  actions,
  confirm,
  reason,
}: {
  /** e.g. "/api/v1/vehicles/abc/status" */
  endpoint: string;
  actions: {
    action: string;
    label: string;
    variant?: "primary" | "outline" | "accent";
  }[];
  /** Optional confirmation prompt per action (e.g. archiving). */
  confirm?: Record<string, string>;
  /**
   * Optional free-text justification per action. `field` names the JSON key
   * the endpoint expects (defaults to "reason"); set `required` when the route
   * rejects an empty value.
   */
  reason?: Record<
    string,
    { field?: string; label: string; placeholder?: string; required?: boolean }
  >;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");

  async function run(action: string) {
    const reasonConfig = reason?.[action];
    const payload: Record<string, unknown> = { action };
    if (reasonConfig) {
      const field = reasonConfig.field ?? "reason";
      const text = reasonText.trim();
      if (reasonConfig.required && !text) {
        setError("A reason is required.");
        return;
      }
      if (text) payload[field] = text;
    }
    setBusy(action);
    setError(null);
    try {
      await api.post(endpoint, payload);
      setReasonText("");
      setPending(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  function request(action: string) {
    const prompt = confirm?.[action];
    const needsReason = reason?.[action];
    if (prompt || needsReason) {
      setReasonText("");
      setError(null);
      setPending(action);
    } else {
      void run(action);
    }
  }

  const pendingAction = actions.find((a) => a.action === pending);
  const pendingPrompt = pending ? confirm?.[pending] : undefined;
  const pendingReason = pending ? reason?.[pending] : undefined;
  const reasonMissing = Boolean(pendingReason?.required && !reasonText.trim());

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((item) => {
          const ItemIcon = ACTION_ICONS[item.action];
          return (
            <Button
              key={item.action}
              size="sm"
              variant={item.variant ?? "outline"}
              disabled={busy !== null}
              isLoading={busy === item.action}
              onClick={() => request(item.action)}
            >
              {ItemIcon && !busy && <ItemIcon aria-hidden="true" className="h-4 w-4" />}
              {item.label}
            </Button>
          );
        })}
      </div>
      {error && !pending && (
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
              disabled={reasonMissing}
              onClick={() => pending && void run(pending)}
            >
              {pendingAction?.label ?? "Confirm"}
            </Button>
          </>
        }
      >
        {pendingPrompt && <p className="text-body-sm text-ink">{pendingPrompt}</p>}
        {pendingReason && (
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="font-ui text-muted text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
              {pendingReason.label}
            </span>
            <textarea
              value={reasonText}
              onChange={(event) => setReasonText(event.target.value)}
              rows={3}
              placeholder={pendingReason.placeholder}
              className="border-hairline focus:border-ink text-body-sm rounded-md border px-3 py-2 transition-colors outline-none"
            />
          </label>
        )}
        {error && (
          <p
            role="alert"
            className="bg-error/10 text-body-xs border-error/25 text-error mt-3 rounded-md border p-3"
          >
            {error}
          </p>
        )}
      </Modal>
    </div>
  );
}
