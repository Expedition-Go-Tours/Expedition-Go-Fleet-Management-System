"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";

import { Select } from "@/components/ui/fields";
import { DateRangePicker } from "@/components/ui/DateRangePicker";

const STATE_OPTIONS = [
  { value: "OVERDUE", label: "Overdue" },
  { value: "DUE", label: "Due" },
  { value: "DUE_SOON", label: "Due soon" },
  { value: "OK", label: "On schedule" },
  { value: "NOT_CONFIGURED", label: "Not configured" },
] as const;

/**
 * Maintenance board filters. State lives in the URL so the server page owns
 * the derivation: `state` (schedule state), `vehicleId` (specific unit) and
 * `from`/`to` (completion date on the service-record ledger).
 */
export function MaintenanceFilters({
  vehicles,
  showDateFilter = true,
}: {
  vehicles: { id: string; label: string }[];
  /** The date range only affects the service-record ledger, when it is visible. */
  showDateFilter?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const state = searchParams.get("state") ?? "";
  const vehicleId = searchParams.get("vehicleId") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  function update(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    startTransition(() => router.replace(`/maintenance?${params.toString()}`));
  }

  const hasFilters = Boolean(state || vehicleId || from || to);

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={isPending}>
      {showDateFilter && (
        <DateRangePicker
          basePath="/maintenance"
          placeholder="Any service date"
          description="Filter the completed service records below by completion date. Choose a start and end date, or a single day — both are inclusive."
        />
      )}
      <Select
        aria-label="Filter by state"
        value={state}
        onChange={(e) => update({ state: e.target.value })}
        className="w-full sm:w-48"
      >
        <option value="">All states</option>
        {STATE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Filter by vehicle"
        value={vehicleId}
        onChange={(e) => update({ vehicleId: e.target.value })}
        className="w-full sm:w-64"
      >
        <option value="">All vehicles</option>
        {vehicles.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </Select>
      {hasFilters && (
        <button
          type="button"
          onClick={() => router.replace("/maintenance")}
          className="hover:bg-subtle text-body-sm text-muted inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 font-medium transition-colors"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
          Clear filters
        </button>
      )}
    </div>
  );
}
