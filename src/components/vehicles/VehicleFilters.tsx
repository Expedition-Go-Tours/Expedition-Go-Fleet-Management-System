"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Search, X } from "lucide-react";

import { Input, Select } from "@/components/ui/fields";
import { VEHICLE_STATUSES, VEHICLE_TYPES } from "@/lib/domain/vehicle";

/**
 * Vehicles list filters. Values are written into the URL search params so the
 * server page owns filtering/sorting/pagination (no client-only shadow set).
 */
export function VehicleFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const q = searchParams.get("q") ?? "";
  const status = searchParams.get("status") ?? "";
  const type = searchParams.get("type") ?? "";
  const availability = searchParams.get("availability") ?? "";

  function update(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    if (
      next.q !== undefined ||
      next.status !== undefined ||
      next.type !== undefined ||
      next.availability !== undefined
    ) {
      params.delete("page");
    }
    startTransition(() => router.replace(`/vehicles?${params.toString()}`));
  }

  const hasFilters = Boolean(q || status || type || availability);

  return (
    <div
      className="flex flex-wrap items-center gap-2 transition-opacity"
      style={{ opacity: isPending ? 0.6 : 1 }}
      aria-busy={isPending}
    >
      <div className="relative w-full sm:w-64">
        <Search
          aria-hidden="true"
          className="text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
        />
        <Input
          aria-label="Search vehicles"
          value={q}
          onChange={(e) => update({ q: e.target.value })}
          placeholder="Search registration, make, model…"
          className="pl-9"
        />
      </div>
      <Select
        aria-label="Filter by status"
        value={status}
        onChange={(e) => update({ status: e.target.value })}
        className="w-full sm:w-auto"
      >
        <option value="">All statuses</option>
        {VEHICLE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, " ")}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Filter by type"
        value={type}
        onChange={(e) => update({ type: e.target.value })}
        className="w-full sm:w-auto"
      >
        <option value="">All types</option>
        {VEHICLE_TYPES.map((t) => (
          <option key={t} value={t}>
            {t.replace(/_/g, " ")}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Filter by availability"
        value={availability}
        onChange={(e) => update({ availability: e.target.value })}
        className="w-full sm:w-auto"
      >
        <option value="">Any availability</option>
        <option value="available">Available now</option>
        <option value="in_use">In use</option>
      </Select>
      {hasFilters && (
        <button
          type="button"
          onClick={() => router.replace("/vehicles")}
          className="hover:bg-subtle text-body-sm text-muted inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 font-medium transition-colors"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
          Clear filters
        </button>
      )}
    </div>
  );
}
