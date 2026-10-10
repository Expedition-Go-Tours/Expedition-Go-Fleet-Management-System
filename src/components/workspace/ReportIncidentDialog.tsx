"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ShieldPlus } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";
import { INCIDENT_SEVERITIES, INCIDENT_TYPES } from "@/lib/domain/incident";

/**
 * Report an incident from the driver workspace (incident:create).
 * Incident records are restricted: the reporter and authorised roles read
 * them through the incident read-realm; everything else is server-side.
 */
export function ReportIncidentDialog({
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const vehicleId = String(form.get("vehicleId") ?? "");
    const description = String(form.get("description") ?? "").trim();
    if (!vehicleId || !description) {
      setError("Vehicle and description are required.");
      return;
    }
    const occurredAtRaw = String(form.get("occurredAt") ?? "");
    const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : undefined;
    if (occurredAt && Number.isNaN(occurredAt.getTime())) {
      setError("The date and time you entered is not valid.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.post("/api/v1/incidents", {
        vehicleId,
        type: String(form.get("type") ?? "OTHER"),
        severity: String(form.get("severity") ?? "MEDIUM"),
        description,
        location: String(form.get("location") ?? "").trim() || undefined,
        occurredAt: occurredAt ? occurredAt.toISOString() : undefined,
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the incident report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <ShieldPlus aria-hidden="true" className="h-4 w-4" />
        Report an incident
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Report an incident"
        description="Accidents, breakdowns, passenger or security incidents. Records are kept restricted; describe what happened."
        size="lg"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" form="incident-form" isLoading={busy}>
              Submit incident report
            </Button>
          </>
        }
      >
        <form id="incident-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && (
            <p
              role="alert"
              className="bg-error/10 text-body-xs border-error/25 text-error rounded-md border p-3"
            >
              {error}
            </p>
          )}

          <Field label="Vehicle" required htmlFor="ic-vehicle">
            <Select id="ic-vehicle" name="vehicleId" required defaultValue={defaultVehicleId ?? ""}>
              <option value="">Select vehicle…</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Type" required htmlFor="ic-type">
              <Select id="ic-type" name="type" defaultValue="OTHER">
                {INCIDENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0) + t.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Severity" required htmlFor="ic-severity">
              <Select id="ic-severity" name="severity" defaultValue="MEDIUM">
                {INCIDENT_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Date and time" hint="Defaults to now when left blank" htmlFor="ic-when">
              <Input id="ic-when" name="occurredAt" type="datetime-local" />
            </Field>
            <Field label="Location" htmlFor="ic-location">
              <Input
                id="ic-location"
                name="location"
                maxLength={300}
                placeholder="e.g. Spintex Road, Accra"
              />
            </Field>
          </div>

          <Field label="Description" required htmlFor="ic-description">
            <Textarea
              id="ic-description"
              name="description"
              rows={5}
              required
              maxLength={4000}
              placeholder="What happened, who was involved, and the state of the vehicle afterwards."
            />
          </Field>
        </form>
      </Modal>
    </>
  );
}
