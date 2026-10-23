"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { PlusCircle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";
import {
  buildFuelCreatePayload,
  FUEL_TYPES_SUPPORTED,
  type FuelPurchaseFormValues,
} from "@/lib/domain/fuel";

/**
 * Record a fuel purchase. The server is the authority (it also mirrors the
 * cost into the canonical expense and the odometer ledger), but the body is
 * built by the same pure domain helper that is unit-tested.
 */
export function AddFuelDialog({
  canCreate,
  vehicles,
  defaultVehicleId,
}: {
  canCreate: boolean;
  vehicles: { id: string; label: string }[];
  defaultVehicleId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One token per opened form: a retried submission cannot double-record.
  const clientTokenRef = useRef<string>("");

  function openDialog() {
    clientTokenRef.current = crypto.randomUUID();
    setOpen(true);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = buildFuelCreatePayload(readValues(form));
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      return;
    }
    try {
      await api.post("/api/v1/fuel", {
        ...result.payload,
        clientToken: clientTokenRef.current,
      });
      setOpen(false);
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the fuel purchase");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="accent" onClick={openDialog} disabled={!canCreate}>
        <PlusCircle aria-hidden="true" className="h-4 w-4" />
        Record fuel
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record fuel purchase"
        description="Record the total amount paid. The cost is mirrored into the expense ledger; the odometer is optional."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" type="submit" form="add-fuel-form" isLoading={busy}>
              Record fuel
            </Button>
          </>
        }
      >
        <form
          id="add-fuel-form"
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
          <Field label="Vehicle" required htmlFor="af-vehicle">
            <Select id="af-vehicle" name="vehicleId" defaultValue={defaultVehicleId ?? ""} required>
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
          <Field label="Date" required htmlFor="af-date">
            <Input
              id="af-date"
              name="transactedOn"
              type="date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </Field>
          <Field
            label="Odometer (km)"
            hint="Optional — leave blank if nobody could read the dashboard. It must not go backwards when entered."
            htmlFor="af-odometer"
          >
            <Input
              id="af-odometer"
              name="odometerKm"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              placeholder="e.g. 128450"
            />
          </Field>
          <Field label="Fuel type" htmlFor="af-fuel">
            <Select id="af-fuel" name="fuelType" defaultValue="PETROL">
              {FUEL_TYPES_SUPPORTED.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Amount paid"
            required
            hint="Total on the receipt. No litres or price per litre needed."
            htmlFor="af-amount"
          >
            <Input
              id="af-amount"
              name="amount"
              type="number"
              min={0.01}
              step="0.01"
              inputMode="decimal"
              placeholder="e.g. 500.00"
              required
            />
          </Field>
          <Field
            label="Station"
            hint="Optional — also becomes the expense supplier."
            htmlFor="af-station"
          >
            <Input id="af-station" name="station" placeholder="e.g. Goil, Accra Central" />
          </Field>
          <div className="flex flex-col justify-end gap-1.5 sm:col-span-2">
            <div className="flex flex-wrap items-center gap-3">
              <label className="hover:bg-subtle border-hairline flex cursor-pointer items-center gap-2 rounded-md border p-2.5">
                <input
                  type="checkbox"
                  name="fullTank"
                  defaultChecked
                  className="accent-orange h-4 w-4"
                />
                <span className="text-data text-ink">Filled to full tank</span>
              </label>
            </div>
            <p className="text-body-xs text-muted">
              Amount-only fill-ups still count as fuel spend. Efficiency needs litres and odometer
              readings, so these are not measured.
            </p>
          </div>
        </form>
      </Modal>
    </>
  );
}

function readValues(form: FormData): FuelPurchaseFormValues {
  return {
    vehicleId: String(form.get("vehicleId") ?? ""),
    transactedOn: String(form.get("transactedOn") ?? ""),
    odometerKm: String(form.get("odometerKm") ?? ""),
    amount: String(form.get("amount") ?? ""),
    fuelType: String(form.get("fuelType") ?? ""),
    station: String(form.get("station") ?? ""),
    fullTank: form.get("fullTank") === "on",
  };
}
