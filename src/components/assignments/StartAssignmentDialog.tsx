"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Route } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";
import { ASSIGNMENT_PURPOSES } from "@/lib/domain/assignment";

/*
 * Start-assignment dialog, used by two audiences:
 *  - Staff (assignment:create) assign a specific driver to a vehicle.
 *  - A driver (assignment:start) starts their own trip.
 *
 * Every mutation goes through POST /api/v1/assignments, so the vehicle
 * reservation, safety-hold bar, odometer ledger and audit trail all stay on
 * the server. The start odometer defaults to the vehicle's current reading.
 */

export interface AssignmentVehicleOption {
  id: string;
  label: string;
  odometerKm: number;
}

export interface AssignmentDriverOption {
  id: string;
  label: string;
}

function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function StartAssignmentDialog({
  vehicles,
  drivers,
  defaultVehicleId,
  canAssignOthers = false,
  label = "Start a trip",
  variant = "primary",
}: {
  vehicles: AssignmentVehicleOption[];
  /** Present in staff mode — the driver being assigned the vehicle. */
  drivers?: AssignmentDriverOption[];
  defaultVehicleId?: string;
  /** True when the viewer may assign a vehicle to another user (staff). */
  canAssignOthers?: boolean;
  label?: string;
  variant?: "primary" | "accent" | "outline" | "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState(defaultVehicleId ?? vehicles[0]?.id ?? "");
  const [startKm, setStartKm] = useState(() => {
    const v = vehicles.find((x) => x.id === (defaultVehicleId ?? vehicles[0]?.id));
    return v ? String(v.odometerKm) : "";
  });

  function openDialog() {
    setError(null);
    const first = defaultVehicleId ?? vehicles[0]?.id ?? "";
    const v = vehicles.find((x) => x.id === first);
    setVehicleId(first);
    setStartKm(v ? String(v.odometerKm) : "");
    setOpen(true);
  }

  function onVehicleChange(id: string) {
    setVehicleId(id);
    const v = vehicles.find((x) => x.id === id);
    if (v) setStartKm(String(v.odometerKm));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const km = Number(startKm);
    const driverUserId = String(form.get("driverUserId") ?? "").trim();

    if (!vehicleId) {
      setError("Select a vehicle.");
      return;
    }
    if (canAssignOthers && !driverUserId) {
      setError("Select a driver.");
      return;
    }
    if (!Number.isSafeInteger(km) || km < 0) {
      setError("Enter a valid start odometer in whole kilometres.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.post("/api/v1/assignments", {
        vehicleId,
        ...(driverUserId ? { driverUserId } : {}),
        purpose: String(form.get("purpose") ?? "OTHER"),
        startOdometerKm: km,
        externalReference: String(form.get("externalReference") ?? "").trim() || undefined,
        notes: String(form.get("notes") ?? "").trim() || undefined,
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the assignment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} onClick={openDialog}>
        <Route aria-hidden="true" className="h-4 w-4" />
        {label}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={canAssignOthers ? "Assign a driver" : "Start a trip"}
        description="The vehicle is reserved and the start odometer is written to the accepted readings ledger."
        size="lg"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              form="start-assignment-form"
              isLoading={busy}
            >
              {canAssignOthers ? "Assign driver" : "Start trip"}
            </Button>
          </>
        }
      >
        <form id="start-assignment-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && (
            <p
              role="alert"
              className="bg-error/10 text-body-xs border-error/25 text-error rounded-md border p-3"
            >
              {error}
            </p>
          )}

          {canAssignOthers && drivers && (
            <Field label="Driver" required htmlFor="sa-driver">
              <Select id="sa-driver" name="driverUserId" required defaultValue="">
                <option value="">Select driver…</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Vehicle" required htmlFor="sa-vehicle">
            <Select
              id="sa-vehicle"
              name="vehicleId"
              required
              value={vehicleId}
              onChange={(e) => onVehicleChange(e.target.value)}
            >
              <option value="">Select vehicle…</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Purpose" required htmlFor="sa-purpose" hint="Recorded on the trip log.">
              <Select id="sa-purpose" name="purpose" required defaultValue="TOUR">
                {ASSIGNMENT_PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {humanize(p)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Start odometer (km)"
              required
              htmlFor="sa-km"
              hint="Defaults to the vehicle's current reading."
            >
              <Input
                id="sa-km"
                name="startOdometerKm"
                type="number"
                min={0}
                step={1}
                required
                value={startKm}
                onChange={(e) => setStartKm(e.target.value)}
              />
            </Field>
          </div>

          <Field
            label="Reference"
            htmlFor="sa-ref"
            hint="Optional booking, tour or transfer reference."
          >
            <Input id="sa-ref" name="externalReference" maxLength={200} />
          </Field>

          <Field label="Notes" htmlFor="sa-notes">
            <Textarea id="sa-notes" name="notes" rows={2} maxLength={1000} />
          </Field>
        </form>
      </Modal>
    </>
  );
}
