"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ClipboardCheck, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";
import type { InspectionResult } from "@/lib/domain/inspection";

export interface ChecklistItemOption {
  key: string;
  label: string;
  critical: boolean;
}

/**
 * Pre-trip / return inspection. The checklist is rendered server-provided
 * (default checklist); results are posted to /api/v1/inspections, which
 * records the odometer through the ledger, creates linked issues for failed
 * critical items and applies the safety hold — all server-side.
 */
export function InspectionDialog({
  vehicleId,
  vehicleLabel,
  type,
  assignmentId,
  currentOdometerKm,
  checklist,
}: {
  vehicleId: string;
  vehicleLabel: string;
  type: "PRE_TRIP" | "RETURN";
  assignmentId?: string;
  currentOdometerKm: number;
  checklist: ChecklistItemOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, InspectionResult>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const title = type === "PRE_TRIP" ? "Pre-trip inspection" : "Return inspection";
  const failedCritical = checklist.filter((item) => results[item.key] === "FAIL" && item.critical);

  function setResult(key: string, result: InspectionResult) {
    setResults((prev) => ({ ...prev, [key]: result }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const odometerKm = Number(form.get("odometerKm"));
    if (!Number.isSafeInteger(odometerKm) || odometerKm < 0) {
      setError("Enter a valid odometer reading (whole kilometres).");
      return;
    }
    const items = checklist.map((item) => ({
      key: item.key,
      result: results[item.key] ?? "PASS",
      notes: notes[item.key]?.trim() || undefined,
    }));

    setBusy(true);
    setError(null);
    try {
      const response = await api.post<{ safetyHoldApplied: boolean }>(
        "/api/v1/inspections",
        {
          vehicleId,
          type,
          assignmentId,
          odometerKm,
          items,
          clientToken: `${type}-${vehicleId}-${Date.now()}`,
        },
      );
      if (response?.safetyHoldApplied) {
        setResults({});
        setNotes({});
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the inspection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <ClipboardCheck aria-hidden="true" className="h-4 w-4" />
        {title}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={`${vehicleLabel} — mark each item, then confirm with the odometer reading.`}
        size="lg"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" form="inspection-form" isLoading={busy}>
              Submit {type === "PRE_TRIP" ? "pre-trip" : "return"} inspection
            </Button>
          </>
        }
      >
        <form id="inspection-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="bg-error/10 text-body-xs rounded-md border border-error/25 p-3 text-error">
              {error}
            </p>
          )}
          {failedCritical.length > 0 && (
            <div className="border-warning/30 bg-warning/10 text-warning flex items-start gap-2 rounded-md border p-3">
              <ShieldAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-body-xs">
                Failed critical items will create linked issues and place the vehicle on safety
                hold. The vehicle cannot be worked on until maintenance resolves them and the hold
                is released.
              </p>
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {checklist.map((item) => (
              <li
                key={item.key}
                className={`rounded-md border p-3 ${
                  results[item.key] === "FAIL"
                    ? "border-error/30 bg-error/5"
                    : "border-hairline bg-surface"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-data flex items-center gap-2 font-medium text-ink">
                    {item.label}
                    {item.critical && (
                      <span className="font-ui text-[10px] font-semibold uppercase tracking-[var(--tracking-ui)] text-error">
                        Critical
                      </span>
                    )}
                  </p>
                  <div className="flex gap-1.5" role="radiogroup" aria-label={`Result for ${item.label}`}>
                    {(["PASS", "FAIL", "NOT_APPLICABLE"] as const).map((result) => (
                      <label
                        key={result}
                        className={`cursor-pointer rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                          results[item.key] === result
                            ? result === "FAIL"
                              ? "border-error/40 bg-error/10 text-error"
                              : result === "NOT_APPLICABLE"
                                ? "border-hairline bg-subtle text-muted"
                                : "border-success/40 bg-success/10 text-success"
                            : "border-hairline text-muted hover:bg-subtle"
                        }`}
                      >
                        <input
                          type="radio"
                          name={`item-${item.key}`}
                          value={result}
                          checked={results[item.key] === result}
                          onChange={() => setResult(item.key, result)}
                          className="sr-only"
                        />
                        {result === "NOT_APPLICABLE" ? "N/A" : result.charAt(0) + result.slice(1).toLowerCase()}
                      </label>
                    ))}
                  </div>
                </div>
                {results[item.key] === "FAIL" && (
                  <Field label="Notes (what you found)" htmlFor={`note-${item.key}`} className="mt-2">
                    <Input
                      id={`note-${item.key}`}
                      value={notes[item.key] ?? ""}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [item.key]: e.target.value }))}
                      placeholder="Optional detail for the issue record"
                    />
                  </Field>
                )}
              </li>
            ))}
          </ul>

          <Field
            label="Odometer reading (km)"
            required
            hint={`Current accepted reading: ${currentOdometerKm.toLocaleString()} km`}
            htmlFor="insp-odo"
          >
            <Input id="insp-odo" name="odometerKm" type="number" min={0} step={1} inputMode="numeric" required placeholder="0" />
          </Field>
        </form>
      </Modal>
    </>
  );
}