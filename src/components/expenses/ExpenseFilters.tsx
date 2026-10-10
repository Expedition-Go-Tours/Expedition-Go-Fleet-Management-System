"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";

import { Select } from "@/components/ui/fields";
import { EXPENSE_CATEGORIES } from "@/lib/domain/expense";
import { humanizeEnum } from "@/lib/format";

/**
 * Expenses board filters. State lives in the URL so the server page owns
 * filtering: `category` (exact type) and `vehicleId` (specific unit).
 */
export function ExpenseFilters({ vehicles }: { vehicles: { id: string; label: string }[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const category = searchParams.get("category") ?? "";
  const vehicleId = searchParams.get("vehicleId") ?? "";

  function update(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    startTransition(() => router.replace(`/expenses?${params.toString()}`));
  }

  const hasFilters = Boolean(category || vehicleId);

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={isPending}>
      <Select
        aria-label="Filter by category"
        value={category}
        onChange={(e) => update({ category: e.target.value })}
        className="w-full sm:w-48"
      >
        <option value="">All categories</option>
        {EXPENSE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {humanizeEnum(c)}
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
          onClick={() => router.replace("/expenses")}
          className="hover:bg-subtle text-body-sm text-muted inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 font-medium transition-colors"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
          Clear filters
        </button>
      )}
    </div>
  );
}
