"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";

/**
 * Destructive-action confirmation. Posts { action } (plus optional body) to
 * the given endpoint, then refreshes. Replaces `window.confirm` everywhere so
 * the flow is accessible, branded and error-visible.
 */
export function ConfirmActionButton({
  endpoint,
  action,
  label,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "danger",
  size = "sm",
  body,
  onDone,
}: {
  endpoint: string;
  action: string;
  label: string;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: "danger" | "primary" | "accent";
  size?: "xs" | "sm" | "md";
  /** Extra request fields merged with { action }. */
  body?: Record<string, unknown>;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoint, { action, ...body });
      setOpen(false);
      onDone?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant={variant} size="sm" isLoading={busy} onClick={confirm}>
              {confirmLabel}
            </Button>
          </>
        }
      >
        {error && (
          <p
            role="alert"
            className="bg-error/10 text-body-xs border-error/25 text-error rounded-md border p-3"
          >
            {error}
          </p>
        )}
      </Modal>
    </>
  );
}
