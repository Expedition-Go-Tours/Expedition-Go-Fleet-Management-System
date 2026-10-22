"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { Wrench } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";
import { toPesewas } from "@/lib/domain/expense";
import { formatNumber } from "@/lib/format";

/**
 * Log maintenance that already happened — a garage visit or breakdown repair —
 * without creating a work order first. Four required facts (vehicle, date,
 * odometer, what was done); everything else is optional. The server records
 * the same ServiceRecord, ledger entry and schedule resets as a work-order
 * completion, so service history never cares which path recorded it.
 */
export function LogServiceDialog({
  vehicles,
  schedules,
  defaultVehicleId,
  variant = "outline",
}: {
  vehicles: { id: string; label: string; odometerKm: number }[];
  schedules: { id: string; vehicleId: string; taskName: string }[];
  defaultVehicleId?: string;
  variant?: "outline" | "accent";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState(defaultVehicleId ?? "");
  const [odometerKm, setOdometerKm] = useState("");
  const [odometerTouched, setOdometerTouched] = useState(false);
  const [scheduleIds, setScheduleIds] = useState<string[]>([]);
  const clientTokenRef = useRef<string>("");

  const selected = vehicles.find((v) => v.id === vehicleId);
  const vehicleSchedules = useMemo(
    () => schedules.filter((s) => s.vehicleId === vehicleId),
    [schedules, vehicleId],
  );

  function readingFor(id: string): string {
    const vehicle = vehicles.find((v) => v.id === id);
    return vehicle ? String(vehicle.odometerKm) : "";
  }

  function openDialog() {
    clientTokenRef.current = crypto.randomUUID();
    const initialVehicleId = defaultVehicleId ?? "";
    setVehicleId(initialVehicleId);
    setOdometerKm(readingFor(initialVehicleId));
    setOdometerTouched(false);
    setError(null);
    setOpen(true);
  }

  function changeVehicle(id: string) {
    setVehicleId(id);
    // The last accepted reading is a helpful default, but a deliberate edit
    // must survive a vehicle change (the user's reading wins).
    if (!odometerTouched) setOdometerKm(readingFor(id));
  }

  function toggleSchedule(id: string) {
    setScheduleIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const workPerformed = String(form.get("workPerformed") ?? "").trim();
    if (!vehicleId) {
      setError("Choose the vehicle.");
      setBusy(false);
      return;
    }
    const odometerValue = Number(odometerKm);
    if (!workPerformed) {
      setError("Describe the work performed — this becomes the service record.");
      setBusy(false);
      return;
    }
    if (!Number.isSafeInteger(odometerValue) || odometerValue < 0) {
      setError("A valid odometer (km) is required.");
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
        vehicleId,
        completedAt: String(form.get("completedAt") ?? "") || undefined,
        odometerKm: odometerValue,
        workPerformed,
        providerName: String(form.get("providerName") ?? "").trim() || undefined,
        taskName: String(form.get("taskName") ?? "").trim() || undefined,
        scheduleIds: scheduleIds.length > 0 ? scheduleIds : undefined,
        clientToken: clientTokenRef.current,
      };
      if (costMinor) body.costMinor = costMinor;
      await api.post("/api/v1/service-records", body);
      setOpen(false);
      (event.target as HTMLFormElement).reset();
      setScheduleIds([]);
      setVehicleId(defaultVehicleId ?? "");
      setOdometerKm("");
      setOdometerTouched(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the service.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} onClick={openDialog} disabled={vehicles.length === 0}>
        <Wrench aria-hidden="true" className="h-4 w-4" />
        Log service
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Log completed maintenance"
        description="For work that already happened. Recorded straight into the vehicle's service history and maintenance schedule."
        size="lg"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="accent"
              size="sm"
              type="submit"
              form="log-service-form"
              isLoading={busy}
            >
              Log service
            </Button>
          </>
        }
      >
        <form id="log-service-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && (
            <p
              role="alert"
              className="bg-error/10 text-body-xs border-error/25 text-error rounded-md border p-3"
            >
              {error}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Vehicle" required htmlFor="ls-vehicle">
              <Select
                id="ls-vehicle"
                name="vehicleId"
                value={vehicleId}
                onChange={(e) => changeVehicle(e.target.value)}
                required
              >
                <option value="" disabled>
                  Choose a vehicle
                </option>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date completed" required htmlFor="ls-date">
              <Input
                id="ls-date"
                name="completedAt"
                type="date"
                required
                max={new Date().toISOString().slice(0, 10)}
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field
              label="Odometer (km)"
              required
              hint={
                selected
                  ? `Prefilled with the last accepted reading (${formatNumber(
                      selected.odometerKm,
                    )} km). Correct it if the garage recorded a different value.`
                  : undefined
              }
              htmlFor="ls-odo"
            >
              <Input
                id="ls-odo"
                name="odometerKm"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                required
                value={odometerKm}
                onChange={(event) => {
                  setOdometerKm(event.target.value);
                  setOdometerTouched(true);
                }}
                placeholder="e.g. 128500"
              />
            </Field>
            <Field
              label="Label (optional)"
              hint="Shown in history, e.g. Oil & filter change."
              htmlFor="ls-task"
            >
              <Input id="ls-task" name="taskName" placeholder="e.g. Oil & filter change" />
            </Field>
            <Field
              label="Cost (GHS)"
              hint="Optional — saved as a maintenance expense."
              htmlFor="ls-cost"
            >
              <Input
                id="ls-cost"
                name="costMinor"
                type="number"
                min={0.01}
                step="any"
                inputMode="decimal"
                placeholder="e.g. 450"
              />
            </Field>
          </div>

          <Field label="What was done?" required htmlFor="ls-work">
            <Textarea
              id="ls-work"
              name="workPerformed"
              rows={3}
              required
              placeholder="e.g. Changed engine oil and filter, checked brakes."
            />
          </Field>

          <Field
            label="Provider (optional)"
            hint="Garage or mechanic — saved with the cost."
            htmlFor="ls-provider"
          >
            <Input id="ls-provider" name="providerName" placeholder="e.g. Kingdom Motors" />
          </Field>

          {vehicleSchedules.length > 0 && (
            <div>
              <p className="font-ui text-data-xs text-muted mb-2 font-semibold tracking-[var(--tracking-ui)] uppercase">
                Preventive maintenance this work completed
              </p>
              <div className="flex flex-col gap-1.5">
                {vehicleSchedules.map((s) => (
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
                Tick anything actually serviced — its due date moves to this completion.
              </p>
            </div>
          )}
        </form>
      </Modal>
    </>
  );
}
