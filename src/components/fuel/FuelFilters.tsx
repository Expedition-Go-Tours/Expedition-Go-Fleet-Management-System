"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";

import { Select } from "@/components/ui/fields";

/** Fuel ledger filter (vehicle) — URL-driven, server page owns the rows. */
export function FuelFilters({ vehicles }: { vehicles: { id: string; label: string }[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const vehicleId = searchParams.get("vehicleId") ?? "";

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={isPending}>
      <Select
        aria-label="Filter by vehicle"
        value={vehicleId}
        onChange={(e) => {
          const params = new URLSearchParams(searchParams.toString());
          if (e.target.value) params.set("vehicleId", e.target.value);
          else params.delete("vehicleId");
          startTransition(() => router.replace(`/fuel?${params.toString()}`));
        }}
        className="w-full sm:w-64"
      >
        <option value="">All vehicles</option>
        {vehicles.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </Select>
      {vehicleId && (
        <button
          type="button"
          onClick={() => router.replace("/fuel")}
          className="hover:bg-subtle text-body-sm text-muted inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 font-medium transition-colors"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
          Clear filter
        </button>
      )}
    </div>
  );
}
