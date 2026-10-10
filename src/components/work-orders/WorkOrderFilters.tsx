"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";

import { Select } from "@/components/ui/fields";
import { WORK_ORDER_STATUSES } from "@/lib/domain/work-order";

/**
 * Work-orders board filters. State lives in the URL so the server page owns
 * filtering: `vehicleId` (specific unit), `status` (exact state) and `open`
 * (all actively-open states: OPEN, IN_PROGRESS, WAITING). Deriving the visible
 * set server-side keeps the title/count and the rows in agreement.
 */
export function WorkOrderFilters({ vehicles }: { vehicles: { id: string; label: string }[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const vehicleId = searchParams.get("vehicleId") ?? "";
  const status = searchParams.get("status") ?? "";
  const open = searchParams.get("open") ?? "";

  function update(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    startTransition(() => router.replace(`/work-orders?${params.toString()}`));
  }

  // The status select mirrors `open` when it is set so the control reflects
  // what the server is actually showing.
  const statusValue = open === "1" ? "__open__" : status;
  const hasFilters = Boolean(vehicleId || status || open);

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={isPending}>
      <Select
        aria-label="Filter by vehicle"
        value={vehicleId}
        onChange={(e) => update({ vehicleId: e.target.value })}
        className="w-full sm:w-56"
      >
        <option value="">All vehicles</option>
        {vehicles.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Filter by status"
        value={statusValue}
        onChange={(e) => {
          const value = e.target.value;
          if (value === "__open__") update({ status: "", open: "1" });
          else update({ status: value, open: "" });
        }}
        className="w-full sm:w-44"
      >
        <option value="">All statuses</option>
        <option value="__open__">Open (active)</option>
        {WORK_ORDER_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, " ")}
          </option>
        ))}
      </Select>
      {hasFilters && (
        <button
          type="button"
          onClick={() => router.replace("/work-orders")}
          className="hover:bg-subtle text-body-sm text-muted inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 font-medium transition-colors"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
          Clear filters
        </button>
      )}
    </div>
  );
}
