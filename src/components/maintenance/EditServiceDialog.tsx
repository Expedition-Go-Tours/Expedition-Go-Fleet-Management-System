"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/fields";
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
 * Correct a completed service record (service:update — operations and admin).
 *
 * The vehicle and odometer are read-only: they belong to the mileage ledger,
 * where corrections have their own audited workflow. The completion date, what
 * was done, provider, technician, payee, notes and the cost breakdown can be
 * fixed here. The server moves the linked expense and the schedules this
 * record last reset in the same transaction, and audits before/after.
 */
export function EditServiceDialog({
  record,
}: {
  record: {
    id: string;
    vehicleLabel: string;
    completedOn: string;
    taskName: string;
    workPerformed: string;
    providerName?: string;
    technicianName?: string;
    paidTo?: string;
    notes?: string;
    odometerKm: number | null;
    repairCostMinor?: number;
    repairCostCurrency?: string;
    labourCostMinor?: number;
    costItems?: { name: string; amountMinor: number }[];
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [completedOn, setCompletedOn] = useState(record.completedOn);
  const [taskName, setTaskName] = useState(record.taskName);
  const [workPerformed, setWorkPerformed] = useState(record.workPerformed);
  const [providerName, setProviderName] = useState(record.providerName ?? "");
  const [technicianName, setTechnicianName] = useState(record.technicianName ?? "");
  const [paidTo, setPaidTo] = useState(record.paidTo ?? "");
  const [notes, setNotes] = useState(record.notes ?? "");
  const [labour, setLabour] = useState("");
  const [costItems, setCostItems] = useState<CostItemDraft[]>([]);

  const itemsTotalMinor = (record.costItems ?? []).reduce((sum, item) => sum + item.amountMinor, 0);
  // Legacy records stored one total without a breakdown: keep that total in
  // workmanship so opening the dialog never looks like an attempt to clear it.
  const initialLabourMinor = Math.max(0, (record.repairCostMinor ?? 0) - itemsTotalMinor);

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
    setCompletedOn(record.completedOn);
    setTaskName(record.taskName);
    setWorkPerformed(record.workPerformed);
    setProviderName(record.providerName ?? "");
    setTechnicianName(record.technicianName ?? "");
    setPaidTo(record.paidTo ?? "");
    setNotes(record.notes ?? "");
    setLabour(
      initialLabourMinor > 0 || (record.costItems ?? []).length > 0
        ? (initialLabourMinor / 100).toFixed(2)
        : "",
    );
    setCostItems(
      (record.costItems ?? []).map((item) => ({
        id: crypto.randomUUID(),
        name: item.name,
        amount: (item.amountMinor / 100).toFixed(2),
      })),
    );
    setError(null);
    setOpen(true);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const work = workPerformed.trim();
    if (!work) {
      setError("Describe the work performed — this becomes the service record.");
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

    if (typeof record.repairCostMinor === "number" && record.repairCostMinor > 0 && !hasCost) {
      setError(
        "This service already has a recorded cost. Enter a positive amount; void the expense to reverse it.",
      );
      setBusy(false);
      return;
    }

    try {
      const body: Record<string, unknown> = {
        completedAt: completedOn,
        taskName: taskName.trim() || undefined,
        workPerformed: work,
        providerName: providerName.trim() || undefined,
        technicianName: technicianName.trim() || undefined,
        paidTo: paidTo.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      if (hasCost) {
        body.labourMinor = labourMinor ?? 0;
        body.items = parsedItems;
        body.currency = record.repairCostCurrency ?? "GHS";
      }
      await api.patch(`/api/v1/service-records/${record.id}`, body);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the correction.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={openDialog}
        aria-label={`Edit service record for ${record.vehicleLabel} on ${record.completedOn}`}
      >
        <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
        Edit
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Correct service record"
        description="Fix a recorded mistake. The date moves the maintenance baseline and the linked expense; the vehicle and odometer stay in the mileage ledger."
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
              form="edit-service-form"
              isLoading={busy}
            >
              Save correction
            </Button>
          </>
        }
      >
        <form id="edit-service-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && (
            <p
              role="alert"
              className="bg-error/10 text-body-xs border-error/25 text-error rounded-md border p-3"
            >
              {error}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Vehicle" hint="The vehicle on a service record cannot be changed.">
              <Input value={record.vehicleLabel} readOnly />
            </Field>
            <Field
              label="Odometer"
              hint={
                record.odometerKm !== null
                  ? "Correct a wrong reading through the odometer history."
                  : "No reading was recorded with this service."
              }
            >
              <Input
                value={
                  record.odometerKm !== null
                    ? `${formatNumber(record.odometerKm)} km`
                    : "No reading"
                }
                readOnly
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Date completed" required htmlFor="es-date">
              <Input
                id="es-date"
                type="date"
                value={completedOn}
                onChange={(event) => setCompletedOn(event.target.value)}
                max={new Date().toISOString().slice(0, 10)}
                required
              />
            </Field>
            <Field
              label="Label (optional)"
              hint="Shown in history, e.g. Oil & filter change."
              htmlFor="es-task"
            >
              <Input
                id="es-task"
                value={taskName}
                onChange={(event) => setTaskName(event.target.value)}
                placeholder="e.g. Oil & filter change"
              />
            </Field>
          </div>

          <Field label="What was done?" required htmlFor="es-work">
            <Textarea
              id="es-work"
              rows={3}
              value={workPerformed}
              onChange={(event) => setWorkPerformed(event.target.value)}
              required
              placeholder="e.g. Changed engine oil and filter, checked brakes."
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Provider (optional)"
              hint="Garage or mechanic — saved with the cost."
              htmlFor="es-provider"
            >
              <Input
                id="es-provider"
                value={providerName}
                onChange={(event) => setProviderName(event.target.value)}
                placeholder="e.g. Kingdom Motors"
              />
            </Field>
            <Field
              label="Technician (optional)"
              hint="The person who did the work."
              htmlFor="es-technician"
            >
              <Input
                id="es-technician"
                value={technicianName}
                onChange={(event) => setTechnicianName(event.target.value)}
                placeholder="e.g. Ama Owusu"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Paid to (representative / driver)"
              hint="Optional — clears the payee if left blank."
              htmlFor="es-paid-to"
            >
              <Input
                id="es-paid-to"
                value={paidTo}
                onChange={(event) => setPaidTo(event.target.value)}
                placeholder="e.g. Kofi Mensah"
              />
            </Field>
            <Field label="Notes (optional)" hint="Context for the next person." htmlFor="es-notes">
              <Input
                id="es-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="e.g. Replaced under warranty"
              />
            </Field>
          </div>

          <fieldset className="border-hairline rounded-md border p-3">
            <legend className="font-ui text-data-xs text-muted px-1 font-semibold tracking-[var(--tracking-ui)] uppercase">
              Cost
            </legend>
            <p className="text-data-xs text-muted mt-1">
              The linked maintenance expense is updated with this breakdown. An existing cost cannot
              be cleared here — void the expense instead if the money should be reversed.
            </p>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Workmanship (GHS)"
                hint="Labour charged by the garage."
                htmlFor="es-labour"
              >
                <Input
                  id="es-labour"
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={labour}
                  onChange={(event) => setLabour(event.target.value)}
                  placeholder="e.g. 200"
                />
              </Field>
              <div className="flex items-end">
                <p className="text-data-xs text-muted">
                  {typeof record.repairCostMinor === "number"
                    ? `Currently ${formatMoney(
                        record.repairCostMinor,
                        record.repairCostCurrency ?? "GHS",
                      )} on the expense ledger.`
                    : "No cost recorded yet — add one here if the invoice has arrived."}
                </p>
              </div>
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
                    <Field label={`Item ${index + 1}`} htmlFor={`es-item-name-${item.id}`}>
                      <Input
                        id={`es-item-name-${item.id}`}
                        value={item.name}
                        onChange={(event) => updateCostItem(item.id, { name: event.target.value })}
                        placeholder="e.g. Oil filter"
                      />
                    </Field>
                    <Field label="Cost (GHS)" htmlFor={`es-item-cost-${item.id}`}>
                      <Input
                        id={`es-item-cost-${item.id}`}
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
              <span className="text-data-xs text-muted">Corrected total</span>
              <span className="text-data text-ink font-medium tabular-nums">
                {previewTotalMinor > 0 ? formatMoney(previewTotalMinor) : "—"}
              </span>
            </div>
          </fieldset>
        </form>
      </Modal>
    </>
  );
}
