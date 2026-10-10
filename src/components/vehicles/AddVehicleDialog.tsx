"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PlusCircle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";
import { VEHICLE_TYPES, FUEL_TYPES } from "@/lib/domain/vehicle";

/**
 * Register a vehicle. Sends the initial odometer as `odometerKm` (the retired
 * `mileage` field is never sent) so the baseline enters the ledger as an
 * audited setup reading. All validation is enforced server-side too.
 */
export function AddVehicleDialog({
  canCreate,
}: {
  canCreate: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {
      regNumber: String(form.get("regNumber") ?? "").trim().toUpperCase(),
      make: String(form.get("make") ?? "").trim(),
      model: String(form.get("model") ?? "").trim(),
      year: Number(form.get("year")),
      type: String(form.get("type") ?? "BUS"),
      fuelType: String(form.get("fuelType") ?? ""),
      vin: String(form.get("vin") ?? "").trim() || undefined,
      seatingCapacity: Number(form.get("seatingCapacity") || 0) || undefined,
      odometerKm: Number(form.get("odometerKm") || 0),
    };
    if (body.fuelType === "" || body.fuelType === "UNSET") body.fuelType = undefined;
    try {
      await api.post("/api/v1/vehicles", body);
      setOpen(false);
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register the vehicle");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)} disabled={!canCreate}>
        <PlusCircle aria-hidden="true" className="h-4 w-4" />
        Register vehicle
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Register vehicle"
        description="Add a company vehicle with its current odometer as the ledger baseline."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" type="submit" form="add-vehicle-form" isLoading={busy}>
              Register vehicle
            </Button>
          </>
        }
      >
        <form id="add-vehicle-form" onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {error && (
            <p role="alert" className="bg-error/10 text-body-xs rounded-md border border-error/25 p-3 text-error sm:col-span-2">
              {error}
            </p>
          )}
          <Field label="Registration number" required htmlFor="av-reg">
            <Input id="av-reg" name="regNumber" required placeholder="e.g. GE 1234-20" autoFocus />
          </Field>
          <Field label="Vehicle type" htmlFor="av-type">
            <Select id="av-type" name="type" defaultValue="BUS">
              {VEHICLE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Make" required htmlFor="av-make">
            <Input id="av-make" name="make" required placeholder="e.g. Toyota" />
          </Field>
          <Field label="Model" required htmlFor="av-model">
            <Input id="av-model" name="model" required placeholder="e.g. Hiace" />
          </Field>
          <Field label="Year" required htmlFor="av-year">
            <Input id="av-year" name="year" type="number" min={1980} max={2027} required defaultValue={new Date().getFullYear()} />
          </Field>
          <Field label="Fuel type" htmlFor="av-fuel">
            <Select id="av-fuel" name="fuelType" defaultValue="">
              <option value="UNSET">Not set</option>
              {FUEL_TYPES.map((fuel) => (
                <option key={fuel} value={fuel}>
                  {fuel}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Initial odometer (km)" hint="Recorded through the odometer ledger as the setup baseline." htmlFor="av-odo">
            <Input id="av-odo" name="odometerKm" type="number" min={0} inputMode="numeric" placeholder="0" />
          </Field>
          <Field label="Seating capacity" htmlFor="av-seats">
            <Input id="av-seats" name="seatingCapacity" type="number" min={1} inputMode="numeric" placeholder="e.g. 14" />
          </Field>
          <Field label="VIN" htmlFor="av-vin">
            <Input id="av-vin" name="vin" placeholder="Optional" />
          </Field>
        </form>
      </Modal>
    </>
  );
}