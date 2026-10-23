"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { Plus, Trash2, Wrench } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";
import { toPesewas } from "@/lib/domain/expense";
import { formatMoney, formatNumber } from "@/lib/format";

interface CostItemDraft {
  id: string;
  name: string;
  amount: string;
}

/**
 * Record maintenance that already happened — a garage visit or breakdown repair —
 * without creating a work order first. Four required facts (vehicle, date,
 * odometer, what was done); everything else is optional. The server records
 * the same ServiceRecord, ledger entry and schedule resets as a work-order
 * completion, so service history never cares which path recorded it.
 */
export function LogServiceDialog({
  vehicles,
  schedules,
  defaultVehicleId,
  canCreate = true,
  variant = "outline",
}: {
  vehicles: { id: string; label: string; odometerKm: number }[];
  schedules: { id: string; vehicleId: string; taskName: string }[];
  defaultVehicleId?: string;
  canCreate?: boolean;
  variant?: "outline" | "accent";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState(defaultVehicleId ?? "");
  const [odometerKm, setOdometerKm] = useState("");
  const [scheduleIds, setScheduleIds] = useState<string[]>([]);
  const [labour, setLabour] = useState("");
  const [costItems, setCostItems] = useState<CostItemDraft[]>([]);
  const clientTokenRef = useRef<string>("");

  const selected = vehicles.find((v) => v.id === vehicleId);
  const vehicleSchedules = useMemo(
    () => schedules.filter((s) => s.vehicleId === vehicleId),
    [schedules, vehicleId],
  );

  // Preview only — the server recomputes and owns the authoritative total.
  const previewTotalMinor = useMemo(() => {
    const labourMinor = labour.trim() ? (toPesewas(labour) ?? 0) : 0;
    const itemsMinor = costItems.reduce(
      (sum, item) => sum + (item.amount.trim() ? (toPesewas(item.amount) ?? 0) : 0),
      0,
    );
    return labourMinor + itemsMinor;
  }, [labour, costItems]);

  function addCostItem() {
    setCostItems((items) => [...items, { id: crypto.randomUUID(), name: "", amount: "" }]);
  }

  function updateCostItem(id: string, patch: Partial<Omit<CostItemDraft, "id">>) {
    setCostItems((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function removeCostItem(id: string) {
    setCostItems((items) => items.filter((item) => item.id !== id));
  }

  function openDialog() {
    clientTokenRef.current = crypto.randomUUID();
    const initialVehicleId = defaultVehicleId ?? "";
    setVehicleId(initialVehicleId);
    // Optional: never prefill a reading that may not belong to this service.
    setOdometerKm("");
    setLabour("");
    setCostItems([]);
    setError(null);
    setOpen(true);
  }

  function changeVehicle(id: string) {
    setVehicleId(id);
    setOdometerKm("");
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
    const odometerValue = odometerKm.trim() ? Number(odometerKm) : undefined;
    if (!workPerformed) {
      setError("Describe the work performed — this becomes the service record.");
      setBusy(false);
      return;
    }
    if (
      odometerValue !== undefined &&
      (!Number.isSafeInteger(odometerValue) || odometerValue < 0)
    ) {
      setError("Odometer must be a whole number of kilometres, or leave it blank.");
      setBusy(false);
      return;
    }
    const labourRaw = labour.trim();
    const labourMinor = labourRaw ? toPesewas(labourRaw) : 0;
    if (labourRaw && labourMinor === null) {
      setError("Workmanship cost must be a valid amount.");
      setBusy(false);
      return;
    }

    // Blank rows are ignored; a half-filled row is a mistake, not a silent drop.
    const filledItems = costItems
      .map((item) => ({ name: item.name.trim(), amountRaw: item.amount.trim() }))
      .filter((item) => item.name !== "" || item.amountRaw !== "");
    if (filledItems.some((item) => item.name === "" || item.amountRaw === "")) {
      setError("Every part needs both a name and a cost.");
      setBusy(false);
      return;
    }
    const parsedItems: { name: string; amountMinor: number }[] = [];
    for (const item of filledItems) {
      const amountMinor = toPesewas(item.amountRaw);
      if (amountMinor === null || amountMinor <= 0) {
        setError(`The cost for “${item.name}” must be a positive amount.`);
        setBusy(false);
        return;
      }
      parsedItems.push({ name: item.name, amountMinor });
    }
    const hasCost = (labourMinor ?? 0) > 0 || parsedItems.length > 0;

    try {
      const body: Record<string, unknown> = {
        vehicleId,
        completedAt: String(form.get("completedAt") ?? "") || undefined,
        workPerformed,
        providerName: String(form.get("providerName") ?? "").trim() || undefined,
        paidTo: String(form.get("paidTo") ?? "").trim() || undefined,
        taskName: String(form.get("taskName") ?? "").trim() || undefined,
        scheduleIds: scheduleIds.length > 0 ? scheduleIds : undefined,
        clientToken: clientTokenRef.current,
      };
      if (odometerValue !== undefined) body.odometerKm = odometerValue;
      if (hasCost) {
        body.labourMinor = labourMinor ?? 0;
        body.items = parsedItems;
      }
      await api.post("/api/v1/service-records", body);
      setOpen(false);
      (event.target as HTMLFormElement).reset();
      setScheduleIds([]);
      setVehicleId(defaultVehicleId ?? "");
      setOdometerKm("");
      setLabour("");
      setCostItems([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the service.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} onClick={openDialog} disabled={!canCreate || vehicles.length === 0}>
        <Wrench aria-hidden="true" className="h-4 w-4" />
        Record maintenance
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record completed maintenance"
        description="For work that already happened. The report, cost and odometer are recorded straight into the vehicle's service history and maintenance schedule."
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
              Record maintenance
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Odometer (km)"
              hint={
                selected
                  ? `Optional. Last accepted reading: ${formatNumber(
                      selected.odometerKm,
                    )} km — entering the service reading also logs it.`
                  : "Optional — leave blank if nobody could read the dashboard."
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
                value={odometerKm}
                onChange={(event) => setOdometerKm(event.target.value)}
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

          <fieldset className="border-hairline rounded-md border p-3">
            <legend className="font-ui text-data-xs text-muted px-1 font-semibold tracking-[var(--tracking-ui)] uppercase">
              Cost (optional)
            </legend>
            <p className="text-data-xs text-muted mt-1">
              Split the invoice into workmanship and the parts actually bought. The server totals it
              and records one maintenance expense.
            </p>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Workmanship (GHS)"
                hint="Labour charged by the garage."
                htmlFor="ls-labour"
              >
                <Input
                  id="ls-labour"
                  name="labour"
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={labour}
                  onChange={(event) => setLabour(event.target.value)}
                  placeholder="e.g. 200"
                />
              </Field>
              <Field
                label="Paid to (representative / driver)"
                hint="Optional — the person who received the money."
                htmlFor="ls-paid-to"
              >
                <Input id="ls-paid-to" name="paidTo" placeholder="e.g. Kofi Mensah" />
              </Field>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="font-ui text-data-xs text-muted font-semibold tracking-[var(--tracking-ui)] uppercase">
                Parts / items bought
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={addCostItem}>
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                Add item
              </Button>
            </div>

            {costItems.length === 0 ? (
              <p className="text-data-xs text-muted mt-2">None added.</p>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                {costItems.map((item, index) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]"
                  >
                    <Field label={`Item ${index + 1}`} htmlFor={`ls-item-name-${item.id}`}>
                      <Input
                        id={`ls-item-name-${item.id}`}
                        value={item.name}
                        onChange={(event) => updateCostItem(item.id, { name: event.target.value })}
                        placeholder="e.g. Oil filter"
                      />
                    </Field>
                    <Field label="Cost (GHS)" htmlFor={`ls-item-cost-${item.id}`}>
                      <Input
                        id={`ls-item-cost-${item.id}`}
                        type="number"
                        min={0.01}
                        step="any"
                        inputMode="decimal"
                        value={item.amount}
                        onChange={(event) =>
                          updateCostItem(item.id, { amount: event.target.value })
                        }
                        placeholder="e.g. 80"
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove item ${index + 1}`}
                      onClick={() => removeCostItem(item.id)}
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="border-hairline mt-3 flex items-center justify-between border-t pt-2">
              <span className="text-data-xs text-muted">Total cost</span>
              <span className="text-data text-ink font-medium tabular-nums">
                {previewTotalMinor > 0 ? formatMoney(previewTotalMinor) : "—"}
              </span>
            </div>
          </fieldset>

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
