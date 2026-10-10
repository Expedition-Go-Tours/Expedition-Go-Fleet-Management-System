"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";
import { ISSUE_CATEGORIES, REPORT_SEVERITIES } from "@/lib/domain/report";

/** Report a vehicle problem from the driver workspace (report:create). */
export function ReportProblemDialog({
  vehicles,
  defaultVehicleId,
}: {
  vehicles: { id: string; label: string }[];
  defaultVehicleId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [severity, setSeverity] = useState("MEDIUM");
  const [immobilized, setImmobilized] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const vehicleId = String(form.get("vehicleId") ?? "");
    const title = String(form.get("title") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    if (!vehicleId || !title || !description) {
      setError("Vehicle, title and description are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/v1/reports", {
        vehicleId,
        title,
        description,
        severity,
        category: String(form.get("category") ?? "") || undefined,
        immobilized,
        clientToken: `ws-problem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the report.");
    } finally {
      setBusy(false);
    }
  }

  const safetyNote = severity === "CRITICAL";

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <AlertTriangle aria-hidden="true" className="h-4 w-4" />
        Report a problem
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Report a vehicle problem"
        description="Critical defects keep the vehicle on record and place it on safety hold — that cannot be undone from here."
        size="lg"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" form="problem-form" isLoading={busy}>
              Submit report
            </Button>
          </>
        }
      >
        <form id="problem-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="bg-error/10 text-body-xs rounded-md border border-error/25 p-3 text-error">
              {error}
            </p>
          )}

          <Field label="Vehicle" required htmlFor="pp-vehicle">
            <Select id="pp-vehicle" name="vehicleId" required defaultValue={defaultVehicleId ?? ""}>
              <option value="">Select vehicle…</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Title" required htmlFor="pp-title">
            <Input id="pp-title" name="title" required maxLength={200} placeholder="e.g. Brake pedal feels soft" />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Category" htmlFor="pp-category">
              <Select id="pp-category" name="category" defaultValue="">
                <option value="">Select category…</option>
                {ISSUE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, " ").toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Severity" required htmlFor="pp-severity">
              <Select
                id="pp-severity"
                name="severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
              >
                {REPORT_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Description" required htmlFor="pp-description">
            <Textarea
              id="pp-description"
              name="description"
              rows={4}
              required
              maxLength={5000}
              placeholder="What happened, when, and what you noticed while driving."
            />
          </Field>

          <div className="flex flex-wrap gap-4">
            <label className="hover:bg-subtle flex cursor-pointer items-center gap-2 rounded-md border border-hairline p-2.5">
              <input
                type="checkbox"
                checked={immobilized}
                onChange={(e) => setImmobilized(e.target.checked)}
                className="accent-orange h-4 w-4"
              />
              <span className="text-data text-ink">The vehicle cannot be driven</span>
            </label>
          </div>

          {safetyNote && (
            <div className="border-error/30 bg-error/10 text-error flex items-start gap-2 rounded-md border p-3">
              <ShieldAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-body-xs">
                Critical severity places this vehicle on safety hold and bars it from assignments
                until maintenance resolves the issue and releases the hold.
              </p>
            </div>
          )}
        </form>
      </Modal>
    </>
  );
}