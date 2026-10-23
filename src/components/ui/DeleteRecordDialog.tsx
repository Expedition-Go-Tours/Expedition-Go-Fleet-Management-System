"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";

/**
 * Admin-only permanent delete. Unlike voiding, this removes the record, so the
 * flow demands a written reason and a typed confirmation. The API captures the
 * full record in the audit log before deleting it.
 */
export function DeleteRecordDialog({
  endpoint,
  recordLabel,
  description,
  details = [],
  title = "Delete record permanently?",
}: {
  endpoint: string;
  /** Short identification shown in the button label and modal. */
  recordLabel: string;
  description: string;
  /** Consequences the operator should read before confirming. */
  details?: string[];
  title?: string;
}) {
  const router = useRouter();
  const formId = useId();
  const reasonId = useId();
  const confirmationId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const canSubmit = reason.trim().length >= 3 && confirmation.trim().toUpperCase() === "DELETE";

  function openDialog() {
    setReason("");
    setConfirmation("");
    setError(null);
    setOpen(true);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(endpoint, { reason: reason.trim() });
      setOpen(false);
      setReason("");
      setConfirmation("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the record");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={openDialog}
        className="text-error hover:bg-error/10"
        aria-label={`Delete ${recordLabel} permanently`}
      >
        <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
        Delete
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
            <Button
              variant="danger"
              size="sm"
              type="submit"
              form={formId}
              isLoading={busy}
              disabled={busy || !canSubmit}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && (
            <p
              role="alert"
              className="bg-error/10 text-body-xs border-error/25 text-error rounded-md border p-3"
            >
              {error}
            </p>
          )}

          <div className="border-error/25 bg-error/5 text-body-xs rounded-md border p-3">
            <p className="text-ink font-medium">{recordLabel}</p>
            {details.length > 0 && (
              <ul className="text-muted mt-1.5 list-disc space-y-1 pl-4">
                {details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}
          </div>

          <Field
            label="Reason for deleting"
            hint="Kept in the audit log — this is the only trace left after deletion."
            htmlFor={reasonId}
            required
          >
            <Textarea
              id={reasonId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              required
              placeholder="e.g. Duplicate of the 12 Oct entry"
            />
          </Field>

          <Field
            label="Type DELETE to confirm"
            hint="This cannot be undone."
            htmlFor={confirmationId}
            required
          >
            <Input
              id={confirmationId}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              placeholder="DELETE"
              required
            />
          </Field>
        </form>
      </Modal>
    </>
  );
}
