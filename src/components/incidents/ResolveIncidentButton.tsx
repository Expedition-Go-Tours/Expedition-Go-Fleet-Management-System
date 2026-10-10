"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";

/**
 * Resolve an incident — requires a resolution note (accountability: every
 * closed incident records why and by whom). Uses an accessible dialog rather
 * than window.prompt.
 */
export function ResolveIncidentButton({ incidentId }: { incidentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const resolution = String(form.get("resolution") ?? "").trim();
    if (!resolution) {
      setError("A resolution note is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/incidents/${incidentId}/status`, {
        action: "resolve",
        resolution,
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve the incident.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Resolve
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Resolve incident"
        description="Record the outcome, findings and any corrective action — kept on the incident for accountability."
        size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              form="resolve-incident-form"
              isLoading={busy}
            >
              Mark resolved
            </Button>
          </>
        }
      >
        <form id="resolve-incident-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && (
            <p
              role="alert"
              className="bg-error/10 text-body-xs border-error/25 text-error rounded-md border p-3"
            >
              {error}
            </p>
          )}
          <Field label="Resolution note" required htmlFor="ri-resolution">
            <Textarea
              id="ri-resolution"
              name="resolution"
              rows={4}
              required
              placeholder="e.g. Minor side-swipe; no injuries. Driver report + photos reviewed, vehicle cleared after body inspection."
            />
          </Field>
        </form>
      </Modal>
    </>
  );
}
