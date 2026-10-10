"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";

import { Select } from "@/components/ui/fields";

/**
 * Maintenance board filters. Both live in the URL so the server page owns
 * the derivation: `state` (schedule state) and `vehicleId` (specific unit).
 */
export function MaintenanceFilters({ vehicles }: { vehicles: { id: string; label: string }[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const state = searchParams.get("state") ?? "";
  const vehicleId = searchParams.get("vehicleId") ?? "";

  function update(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    startTransition(() => router.replace(`/maintenance?${params.toString()}`));
  }

  const hasFilters = Boolean(state || vehicleId);

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={isPending}>
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
