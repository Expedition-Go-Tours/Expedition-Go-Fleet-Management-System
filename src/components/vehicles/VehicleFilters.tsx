"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
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

  // The search box keeps its own value while typing. Driving it straight from
  // the URL made every keystroke wait for a server navigation, which reset the
  // cursor and made continuous typing unreliable. The URL is still authoritative
  // for the filtered result; it is just updated after a short pause.
  const [query, setQuery] = useState(q);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Reflect external URL changes (clear, back/forward) unless the user is
    // actively typing in the box.
    if (document.activeElement !== inputRef.current) setQuery(q);
  }, [q]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

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

  function updateQuery(value: string) {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      searchTimer.current = null;
      update({ q: value });
    }, 250);
  }

  /** Apply a select filter without losing text still waiting on the debounce. */
  function updateFilter(next: Record<string, string>) {
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    update({ ...next, q: query });
  }

  function clearFilters() {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setQuery("");
    router.replace("/vehicles");
  }

  const hasFilters = Boolean(query || status || type || availability);

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
          ref={inputRef}
          aria-label="Search vehicles"
          value={query}
          onChange={(e) => updateQuery(e.target.value)}
          placeholder="Search registration, make, model…"
          className="pl-9"
        />
      </div>
      <Select
        aria-label="Filter by status"
        value={status}
        onChange={(e) => updateFilter({ status: e.target.value })}
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
        onChange={(e) => updateFilter({ type: e.target.value })}
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
        onChange={(e) => updateFilter({ availability: e.target.value })}
        className="w-full sm:w-auto"
      >
        <option value="">Any availability</option>
        <option value="available">Available now</option>
        <option value="in_use">In use</option>
      </Select>
      {hasFilters && (
        <button
          type="button"
          onClick={clearFilters}
          className="hover:bg-subtle text-body-sm text-muted inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 font-medium transition-colors"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
          Clear filters
        </button>
      )}
    </div>
  );
}
