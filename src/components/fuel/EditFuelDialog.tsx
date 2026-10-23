"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";
import { buildFuelUpdatePayload, FUEL_TYPES_SUPPORTED } from "@/lib/domain/fuel";
import { formatMoney } from "@/lib/format";

/**
 * Correct a recorded fuel purchase. Operations and admin only (fuel:update).
 * The vehicle and odometer are shown read-only: the vehicle is fixed and a
 * wrong reading is corrected through the odometer ledger, never by rewriting
 * the purchase. The server updates the linked expense in the same transaction.
 */
export function EditFuelDialog({
  entry,
}: {
  entry: {
    id: string;
    vehicleLabel: string;
    transactedOn: string;
    totalMinor: number;
    currency: string;
    fuelType: string;
    station?: string;
    paidTo?: string;
    fullTank: boolean;
    odometerKm?: number;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [transactedOn, setTransactedOn] = useState(entry.transactedOn);
  const [amount, setAmount] = useState((entry.totalMinor / 100).toFixed(2));
  const [fuelType, setFuelType] = useState(entry.fuelType);
  const [station, setStation] = useState(entry.station ?? "");
  const [paidTo, setPaidTo] = useState(entry.paidTo ?? "");
  const [fullTank, setFullTank] = useState(entry.fullTank);

  function openDialog() {
    setTransactedOn(entry.transactedOn);
    setAmount((entry.totalMinor / 100).toFixed(2));
    setFuelType(entry.fuelType);
    setStation(entry.station ?? "");
    setPaidTo(entry.paidTo ?? "");
    setFullTank(entry.fullTank);
    setError(null);
    setOpen(true);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = buildFuelUpdatePayload({
      transactedOn,
      amount,
      fuelType,
      station,
      paidTo,
      fullTank,
    });
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      return;
    }
    try {
      await api.patch(`/api/v1/fuel/${entry.id}`, result.payload);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the correction");
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
        aria-label={`Edit fuel entry for ${entry.vehicleLabel} on ${entry.transactedOn}`}
      >
        <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
        Edit
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Correct fuel purchase"
        description="Fix a recorded mistake. The amount and payee are updated on the linked expense too; every change is audited."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" type="submit" form="edit-fuel-form" isLoading={busy}>
              Save correction
            </Button>
          </>
        }
      >
        <form
          id="edit-fuel-form"
          onSubmit={onSubmit}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          {error && (
            <p
              role="alert"
              className="bg-error/10 text-body-xs border-error/25 text-error rounded-md border p-3 sm:col-span-2"
            >
              {error}
            </p>
          )}
          <Field label="Vehicle" hint="The vehicle on a recorded purchase cannot be changed.">
            <Input value={entry.vehicleLabel} readOnly />
          </Field>
          <Field
            label="Odometer"
            hint={
              typeof entry.odometerKm === "number"
                ? "Correct a wrong reading through the odometer history."
                : "No reading was recorded with this purchase."
            }
            htmlFor="ef-odometer"
          >
            <Input
              id="ef-odometer"
              value={
                typeof entry.odometerKm === "number"
                  ? `${entry.odometerKm.toLocaleString()} km`
                  : "No reading"
              }
              readOnly
            />
          </Field>
          <Field label="Date" required htmlFor="ef-date">
            <Input
              id="ef-date"
              type="date"
              value={transactedOn}
              onChange={(event) => setTransactedOn(event.target.value)}
              required
            />
          </Field>
          <Field
            label="Amount paid"
            required
            hint={`Currently ${formatMoney(entry.totalMinor, entry.currency)} on the expense ledger.`}
            htmlFor="ef-amount"
          >
            <Input
              id="ef-amount"
              type="number"
              min={0.01}
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </Field>
          <Field label="Fuel type" htmlFor="ef-fuel">
            <Select
              id="ef-fuel"
              value={fuelType}
              onChange={(event) => setFuelType(event.target.value)}
            >
              {FUEL_TYPES_SUPPORTED.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Paid to (representative / driver)"
            hint="Optional — clears the payee if left blank."
            htmlFor="ef-paid-to"
          >
            <Input
              id="ef-paid-to"
              value={paidTo}
              onChange={(event) => setPaidTo(event.target.value)}
              placeholder="e.g. Kofi Mensah"
            />
          </Field>
          <Field
            label="Station"
            hint="Optional — clears the expense supplier if left blank."
            htmlFor="ef-station"
          >
            <Input
              id="ef-station"
              value={station}
              onChange={(event) => setStation(event.target.value)}
              placeholder="e.g. Goil, Accra Central"
            />
          </Field>
          <div className="flex flex-col justify-end gap-1.5 sm:col-span-2">
            <label className="hover:bg-subtle border-hairline flex cursor-pointer items-center gap-2 rounded-md border p-2.5">
              <input
                type="checkbox"
                checked={fullTank}
                onChange={(event) => setFullTank(event.target.checked)}
                className="accent-orange h-4 w-4"
              />
              <span className="text-data text-ink">Filled to full tank</span>
            </label>
          </div>
        </form>
      </Modal>
    </>
  );
}
