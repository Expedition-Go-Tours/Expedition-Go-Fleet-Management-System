"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ClipboardCheck } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";

export interface CompletionScheduleOption {
  id: string;
  taskName: string;
}

export interface CompletionIssueOption {
  id: string;
  label: string;
}

/**
 * Evidence-gated work-order completion. `complete` is deliberately NOT in the
 * generic status action map: this dialog collects the completion evidence the
 * server requires (work performed + odometer, plus which schedules/issue this
 * work actually addressed), then POSTs to the dedicated /complete route which
 * writes the immutable ServiceRecord, resets named schedule baselines and
 * records the odometer through the ledger in one set of transactions.
 */
export function CompleteWorkOrderDialog({
  workOrderId,
  currentOdometerKm,
  schedules,
  issues,
}: {
  workOrderId: string;
  currentOdometerKm: number;
  schedules: CompletionScheduleOption[];
  issues: CompletionIssueOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allResolved, setAllResolved] = useState(true);
  const [scheduleIds, setScheduleIds] = useState<string[]>(schedules.map((s) => s.id));

  function toggleSchedule(id: string) {
    setScheduleIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const workPerformed = String(form.get("workPerformed") ?? "").trim();
    const odometerKm = Number(form.get("odometerKm"));
    const completedAt = String(form.get("completedAt") ?? "").trim();
    const resolvedIssueIds = allResolved
      ? issues.map((i) => i.id)
      : (form.getAll("resolvedIssueIds") as string[]);

    if (!workPerformed) {
      setError("Describe the work performed — this becomes the service record.");
      setBusy(false);
      return;
    }
    if (!Number.isSafeInteger(odometerKm) || odometerKm < 0) {
      setError("A valid completion odometer (km) is required.");
      setBusy(false);
      return;
    }

    try {
      await api.post(`/api/v1/work-orders/${workOrderId}/complete`, {
        workPerformed,
        odometerKm,
        completedAt: completedAt ? completedAt : undefined,
        scheduleIds: scheduleIds.length > 0 ? scheduleIds : undefined,
        resolvedIssueIds: resolvedIssueIds.length > 0 ? resolvedIssueIds : undefined,
        providerName: String(form.get("providerName") ?? "").trim() || undefined,
        technicianName: String(form.get("technicianName") ?? "").trim() || undefined,
        notes: String(form.get("notes") ?? "").trim() || undefined,
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record completion");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)}>
        <ClipboardCheck aria-hidden="true" className="h-4 w-4" />
        Record completion
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record work-order completion"
        description="Completing creates the service record, resets the selected maintenance baselines and logs the completion odometer in the ledger — this cannot be edited later."
        size="lg"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" size="sm" type="submit" form="complete-wo-form" isLoading={busy}>
              Complete work order
            </Button>
          </>
        }
      >
        <form id="complete-wo-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="bg-error/10 text-body-xs rounded-md border border-error/25 p-3 text-error">
              {error}
            </p>
          )}

          <Field label="Work performed" required htmlFor="cwo-work" hint="Becomes the service record's immutable description.">
            <Textarea id="cwo-work" name="workPerformed" rows={4} required placeholder="e.g. Replaced brake pads front + rear, bled lines, test-driven." />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Completion odometer (km)"
              required
              hint={`Current accepted reading: ${currentOdometerKm.toLocaleString()} km`}
              htmlFor="cwo-odo"
            >
              <Input id="cwo-odo" name="odometerKm" type="number" min={0} inputMode="numeric" required placeholder="0" autoFocus={false} />
            </Field>
            <Field label="Completed at" hint="Defaults to now." htmlFor="cwo-date">
              <Input id="cwo-date" name="completedAt" type="datetime-local" />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Provider name" htmlFor="cwo-provider">
              <Input id="cwo-provider" name="providerName" placeholder="e.g. Kingdom Motors" />
            </Field>
            <Field label="Technician" htmlFor="cwo-tech">
              <Input id="cwo-tech" name="technicianName" placeholder="Optional" />
            </Field>
          </div>

          {schedules.length > 0 && (
            <div>
              <p className="font-ui text-data-xs mb-2 font-semibold uppercase tracking-[var(--tracking-ui)] text-muted">
                Preventive maintenance this work completed
              </p>
              <div className="flex flex-col gap-1.5">
                {schedules.map((s) => (
                  <label key={s.id} className="hover:bg-subtle flex cursor-pointer items-center gap-2.5 rounded-md border border-hairline p-2.5">
                    <input
                      type="checkbox"
                      checked={scheduleIds.includes(s.id)}
                      onChange={() => toggleSchedule(s.id)}
                      className="accent-orange h-4 w-4"
                    />
                    <span className="text-data text-ink">{s.taskName}</span>
                  </label>
                ))}
              </div>
              <p className="text-data-xs mt-1.5 text-muted">
                Only schedules actually serviced are reset — their due date moves to this completion.
              </p>
            </div>
          )}

          {issues.length > 0 && (
            <div>
              <p className="font-ui text-data-xs mb-2 font-semibold uppercase tracking-[var(--tracking-ui)] text-muted">
                Issues resolved by this work
              </p>
              <label className="hover:bg-subtle mb-1.5 flex cursor-pointer items-center gap-2.5 rounded-md border border-hairline p-2.5">
                <input
                  type="checkbox"
                  checked={allResolved}
                  onChange={(e) => setAllResolved(e.target.checked)}
                  className="accent-orange h-4 w-4"
                />
                <span className="text-data text-ink">All linked issues are resolved</span>
              </label>
              {!allResolved && (
                <div className="flex flex-col gap-1.5">
                  {issues.map((issue) => (
                    <label key={issue.id} className="hover:bg-subtle flex cursor-pointer items-center gap-2.5 rounded-md border border-hairline p-2.5">
                      <input type="checkbox" name="resolvedIssueIds" value={issue.id} defaultChecked className="accent-orange h-4 w-4" />
                      <span className="text-data text-ink">{issue.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <Field label="Notes" htmlFor="cwo-notes">
            <Textarea id="cwo-notes" name="notes" rows={2} placeholder="Optional context for the record" />
          </Field>
        </form>
      </Modal>
    </>
  );
}