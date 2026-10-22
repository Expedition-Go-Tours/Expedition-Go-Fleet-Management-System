"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ClipboardCheck, Unlock } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";
import { toPesewas } from "@/lib/domain/expense";

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
 *
 * What the system already knows is prefilled — the odometer from the ledger,
 * linked issues all resolved, attached schedules all serviced — so the form
 * asks only for what actually happened. The optional repair cost is recorded
 * as a canonical MAINTENANCE expense linked to that service record.
 *
 * Completion NEVER releases a safety hold: for a held vehicle the flow ends
 * with an explicit, permission-checked "confirm back in service" step, and the
 * server still refuses to release while any open critical issue remains.
 */
export function CompleteWorkOrderDialog({
  workOrderId,
  vehicleId,
  currentOdometerKm,
  vehicleOnSafetyHold,
  canRelease,
  schedules,
  issues,
}: {
  workOrderId: string;
  vehicleId: string;
  currentOdometerKm: number;
  vehicleOnSafetyHold: boolean;
  canRelease: boolean;
  schedules: CompletionScheduleOption[];
  issues: CompletionIssueOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allResolved, setAllResolved] = useState(true);
  const [scheduleIds, setScheduleIds] = useState<string[]>(schedules.map((s) => s.id));
  // After completing a held vehicle the dialog becomes the return-to-service
  // confirmation — an explicit logged step, never an automatic release.
  const [stage, setStage] = useState<"form" | "return-to-service">("form");

  function toggleSchedule(id: string) {
    setScheduleIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  function close() {
    setOpen(false);
    setStage("form");
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
    const costRaw = String(form.get("costMinor") ?? "").trim();
    const costMinor = costRaw ? toPesewas(costRaw) : null;
    if (costRaw && (costMinor === null || costMinor <= 0)) {
      setError("Repair cost must be a positive amount.");
      setBusy(false);
      return;
    }

    try {
      const body: Record<string, unknown> = {
        workPerformed,
        odometerKm,
        completedAt: completedAt ? completedAt : undefined,
        scheduleIds: scheduleIds.length > 0 ? scheduleIds : undefined,
        resolvedIssueIds: resolvedIssueIds.length > 0 ? resolvedIssueIds : undefined,
        providerName: String(form.get("providerName") ?? "").trim() || undefined,
        technicianName: String(form.get("technicianName") ?? "").trim() || undefined,
        notes: String(form.get("notes") ?? "").trim() || undefined,
      };
      if (costMinor) body.costMinor = costMinor;
      await api.post(`/api/v1/work-orders/${workOrderId}/complete`, body);
      if (vehicleOnSafetyHold) {
        setStage("return-to-service");
        router.refresh();
      } else {
        close();
        (event.target as HTMLFormElement).reset();
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record completion");
    } finally {
      setBusy(false);
    }
  }

  async function confirmReturnToService() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/vehicles/${vehicleId}/status`, {
        action: "release",
        reason: `Repair completed — work order ${workOrderId}`,
      });
      close();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not release the vehicle");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="accent"
        onClick={() => {
          setStage("form");
          setOpen(true);
        }}
      >
        <ClipboardCheck aria-hidden="true" className="h-4 w-4" />
        Record completion
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="Record work-order completion"
        description={
          stage === "form"
            ? "Completing creates the service record, resets the selected maintenance baselines and logs the completion odometer in the ledger — this cannot be edited later."
            : "The repair is recorded. The vehicle is still on safety hold until it is confirmed back in service."
        }
        size="lg"
        footer={
          stage === "form" ? (
            <>
              <Button variant="ghost" size="sm" onClick={close}>
                Cancel
              </Button>
              <Button
                variant="accent"
                size="sm"
                type="submit"
                form="complete-wo-form"
                isLoading={busy}
              >
                Complete work order
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={close}>
                Close
              </Button>
              {canRelease && (
                <Button
                  variant="accent"
                  size="sm"
                  onClick={confirmReturnToService}
                  isLoading={busy}
                >
                  <Unlock aria-hidden="true" className="h-4 w-4" />
                  Confirm back in service
                </Button>
              )}
            </>
          )
        }
      >
        {stage === "return-to-service" ? (
          <div className="flex flex-col gap-3">
            {error && (
              <p
                role="alert"
                className="bg-error/10 text-body-xs border-error/25 text-error rounded-md border p-3"
              >
                {error}
              </p>
            )}
            <p className="text-body-sm text-ink">
              Repair recorded — the service record and its cost are saved and the linked issues are
              closed.
            </p>
            {canRelease ? (
              <p className="text-body-sm text-muted">
                This vehicle is still on safety hold. Confirming back in service returns it to the
                road and is logged against your account; the server will still refuse the release
                while any critical issue is open.
              </p>
            ) : (
              <p className="text-body-sm text-muted">
                This vehicle is still on safety hold. Releasing it back to service is an
                administrator action — ask an admin to confirm the vehicle is roadworthy.
              </p>
            )}
          </div>
        ) : (
          <form id="complete-wo-form" onSubmit={onSubmit} className="flex flex-col gap-4">
            {error && (
              <p
                role="alert"
                className="bg-error/10 text-body-xs border-error/25 text-error rounded-md border p-3"
              >
                {error}
              </p>
            )}

            <Field
              label="Work performed"
              required
              htmlFor="cwo-work"
              hint="Becomes the service record's immutable description."
            >
              <Textarea
                id="cwo-work"
                name="workPerformed"
                rows={4}
                required
                placeholder="e.g. Replaced brake pads front + rear, bled lines, test-driven."
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Completion odometer (km)"
                required
                hint={`Current accepted reading: ${currentOdometerKm.toLocaleString()} km`}
                htmlFor="cwo-odo"
              >
                <Input
                  id="cwo-odo"
                  name="odometerKm"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  required
                  defaultValue={currentOdometerKm}
                  placeholder="0"
                  autoFocus={false}
                />
              </Field>
              <Field label="Completed at" hint="Defaults to now." htmlFor="cwo-date">
                <Input id="cwo-date" name="completedAt" type="datetime-local" />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Provider name" htmlFor="cwo-provider">
                <Input id="cwo-provider" name="providerName" placeholder="e.g. Kingdom Motors" />
              </Field>
              <Field label="Technician" htmlFor="cwo-tech">
                <Input id="cwo-tech" name="technicianName" placeholder="Optional" />
              </Field>
              <Field
                label="Repair cost (GHS)"
                hint="Optional — saved as a maintenance expense."
                htmlFor="cwo-cost"
              >
                <Input
                  id="cwo-cost"
                  name="costMinor"
                  type="number"
                  min={0.01}
                  step="any"
                  inputMode="decimal"
                  placeholder="e.g. 850"
                />
              </Field>
            </div>

            {schedules.length > 0 && (
              <div>
                <p className="font-ui text-data-xs text-muted mb-2 font-semibold tracking-[var(--tracking-ui)] uppercase">
                  Preventive maintenance this work completed
                </p>
                <div className="flex flex-col gap-1.5">
                  {schedules.map((s) => (
                    <label
                      key={s.id}
                      className="hover:bg-subtle border-hairline flex cursor-pointer items-center gap-2.5 rounded-md border p-2.5"
                    >
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
                <p className="text-data-xs text-muted mt-1.5">
                  Only schedules actually serviced are reset — their due date moves to this
                  completion.
                </p>
              </div>
            )}

            {issues.length > 0 && (
              <div>
                <p className="font-ui text-data-xs text-muted mb-2 font-semibold tracking-[var(--tracking-ui)] uppercase">
                  Issues resolved by this work
                </p>
                <label className="hover:bg-subtle border-hairline mb-1.5 flex cursor-pointer items-center gap-2.5 rounded-md border p-2.5">
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
                      <label
                        key={issue.id}
                        className="hover:bg-subtle border-hairline flex cursor-pointer items-center gap-2.5 rounded-md border p-2.5"
                      >
                        <input
                          type="checkbox"
                          name="resolvedIssueIds"
                          value={issue.id}
                          defaultChecked
                          className="accent-orange h-4 w-4"
                        />
                        <span className="text-data text-ink">{issue.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Field label="Notes" htmlFor="cwo-notes">
              <Textarea
                id="cwo-notes"
                name="notes"
                rows={2}
                placeholder="Optional context for the record"
              />
            </Field>
          </form>
        )}
      </Modal>
    </>
  );
}
