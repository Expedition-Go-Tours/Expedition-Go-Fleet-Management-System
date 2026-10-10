"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/fields";
import { api } from "@/lib/client/api";

/**
 * End the driver's active trip: records the end odometer through the API
 * (ledger + distance are server-computed; a decrease is rejected as
 * DECREASE_REJECTED).
 */
export function EndAssignmentButton({
  assignmentId,
  minKm,
  vehicleLabel,
}: {
  assignmentId: string;
  minKm: number;
  vehicleLabel: string;
}) {
  const router = useRouter();
  const [km, setKm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function endTrip() {
    const endOdometerKm = Number(km);
    if (!Number.isSafeInteger(endOdometerKm) || endOdometerKm < 0) {
      setError("Enter the odometer reading at trip end (whole kilometres).");
      return;
    }
    if (endOdometerKm < minKm) {
      setError(`Trip end cannot be below the starting odometer (${minKm.toLocaleString()} km).`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/assignments/${assignmentId}/end`, {
        endOdometerKm,
        clientToken: `e2e-end-${assignmentId}`,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not end the trip.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label={`End odometer (${vehicleLabel})`}
          hint={`Trip start was ${minKm.toLocaleString()} km — end cannot be lower.`}
          htmlFor="end-odo"
          className="w-56"
        >
          <Input
            id="end-odo"
            type="number"
            min={minKm}
            step={1}
            value={km}
            onChange={(e) => setKm(e.target.value)}
            placeholder={`≥ ${minKm.toLocaleString()}`}
          />
        </Field>
        <Button variant="primary" size="md" disabled={busy} isLoading={busy} onClick={endTrip}>
          End trip
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-body-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}