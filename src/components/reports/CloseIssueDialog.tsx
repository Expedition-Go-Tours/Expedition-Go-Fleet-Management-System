"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";

/**
 * Close an issue. Closing is evidence-gated: the server rejects a close
 * without a resolution, a duplicate link, or a not-actionable reason, so the
 * original report is always accounted for. This dialog collects exactly one
 * of those before POSTing.
 */
export function CloseIssueDialog({ issueId }: { issueId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"resolution" | "duplicate" | "not_actionable">("resolution");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const resolution = String(form.get("resolution") ?? "").trim();
    const duplicateOfIssueId = String(form.get("duplicateOfIssueId") ?? "").trim();
    const notActionableReason = String(form.get("notActionableReason") ?? "").trim();

    if (mode === "resolution" && !resolution) {
      setError("A resolution summary is required.");
      setBusy(false);
      return;
    }
    if (mode === "duplicate" && !duplicateOfIssueId) {
      setError("Enter the issue number or id this duplicates.");
      setBusy(false);
      return;
    }
    if (mode === "not_actionable" && !notActionableReason) {
      setError("Explain why this is not actionable.");
      setBusy(false);
      return;
    }

    try {
      await api.post(`/api/v1/reports/${issueId}/status`, {
        action: "close",
        resolution,
        duplicateOfIssueId,
        notActionableReason,
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not close the issue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
        Close issue
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Close issue"
        description="The original report stays on record — pick how this issue is accounted for."
        size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" form="close-issue-form" isLoading={busy}>
              Close issue
            </Button>
          </>
        }
      >
        <form id="close-issue-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="bg-error/10 text-body-xs rounded-md border border-error/25 p-3 text-error">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            {(
              [
                ["resolution", "Resolved — record the fix"],
                ["duplicate", "Duplicate of another issue"],
                ["not_actionable", "Not actionable — explain why"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={`hover:bg-subtle flex cursor-pointer items-center gap-2.5 rounded-md border p-3 transition-colors ${
                  mode === value ? "border-accent bg-accent/5" : "border-hairline"
                }`}
              >
                <input
                  type="radio"
                  name="closeMode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="accent-orange h-4 w-4"
                />
                <span className="text-data text-sm font-medium text-ink">{label}</span>
              </label>
            ))}
          </div>

          {mode === "resolution" && (
            <Field label="Resolution summary" required htmlFor="ci-resolution">
              <Textarea
                id="ci-resolution"
                name="resolution"
                rows={4}
                placeholder="e.g. Replaced the brake pads; test drive confirms normal operation."
              />
            </Field>
          )}
          {mode === "duplicate" && (
            <Field
              label="Issue it duplicates (number or id)"
              required
              hint="The duplicate is recorded on this report for the audit trail."
              htmlFor="ci-duplicate"
            >
              <Input id="ci-duplicate" name="duplicateOfIssueId" placeholder="ISS-2026-000123" />
            </Field>
          )}
          {mode === "not_actionable" && (
            <Field label="Why it is not actionable" required htmlFor="ci-notactionable">
              <Textarea
                id="ci-notactionable"
                name="notActionableReason"
                rows={3}
                placeholder="e.g. Cosmetic only, no impact on safety operation."
              />
            </Field>
          )}
        </form>
      </Modal>
    </>
  );
}