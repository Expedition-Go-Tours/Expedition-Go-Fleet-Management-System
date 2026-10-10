"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";

import { Select } from "@/components/ui/fields";
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES } from "@/lib/domain/incident";

/**
 * Incidents board filters. State lives in the URL so the server page owns
 * filtering: `severity` (exact level) and `status` (exact state).
 */
export function IncidentFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const severity = searchParams.get("severity") ?? "";
  const status = searchParams.get("status") ?? "";

  function update(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    startTransition(() => router.replace(`/incidents?${params.toString()}`));
  }

  const hasFilters = Boolean(severity || status);

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={isPending}>
      <Select
        aria-label="Filter by severity"
        value={severity}
        onChange={(e) => update({ severity: e.target.value })}
        className="w-full sm:w-44"
      >
        <option value="">All severities</option>
        {INCIDENT_SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Filter by status"
        value={status}
        onChange={(e) => update({ status: e.target.value })}
        className="w-full sm:w-44"
      >
        <option value="">All statuses</option>
        {INCIDENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, " ")}
          </option>
        ))}
      </Select>
      {hasFilters && (
        <button
          type="button"
          onClick={() => router.replace("/incidents")}
          className="hover:bg-subtle text-body-sm text-muted inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 font-medium transition-colors"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
          Clear filters
        </button>
      )}
    </div>
  );
}
