"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/fields";
import { cn } from "@/lib/cn";
import type { RouteLeg, TripStop } from "@/lib/domain/trip";

/*
 * Interactive multi-stop route builder with location search.
 *
 * Renders an ordered list of stops with add/remove/reorder controls.
 * Each stop has a search-as-you-type place field backed by the server-side
 * Photon geocoding endpoint, with a manual-coordinate fallback for power
 * users or when the provider is unavailable.
 */

const STOP_PURPOSES = [
  "Pickup",
  "Drop-off",
  "Tour visit",
  "Fuel",
  "Workshop",
  "Business errand",
  "Other",
] as const;

let nextId = 0;
function makeStopId() {
  nextId += 1;
  return `s_${Date.now().toString(36)}_${nextId}`;
}

export function makeStop(sequence: number, type: TripStop["type"], label = ""): TripStop {
  return {
    id: makeStopId(),
    sequence,
    type,
    label,
    address: null,
    latitude: null,
    longitude: null,
    placeId: null,
    purpose: null,
    notes: null,
    arrivedAt: null,
    departedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Place search input
// ---------------------------------------------------------------------------

interface PlaceResult {
  label: string;
  latitude: number;
  longitude: number;
  placeId?: string;
}

function PlaceSearch({
  value,
  onSelect,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onSelect: (place: PlaceResult) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Track the sequence of searches so stale responses are discarded.
  const searchSeq = useRef(0);

  function search(q: string) {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    const seq = ++searchSeq.current;
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/trips/search-places?q=${encodeURIComponent(q.trim())}`);
        // Discard stale response if a newer search was started.
        if (seq !== searchSeq.current) return;
        if (!res.ok) {
          setResults([]);
          return;
        }
        const data = (await res.json()) as { places: PlaceResult[] };
        if (seq !== searchSeq.current) return;
        setResults(data.places ?? []);
        setOpen((data.places ?? []).length > 0);
      } catch {
        if (seq === searchSeq.current) setResults([]);
      } finally {
        if (seq === searchSeq.current) setLoading(false);
      }
    }, 300);
  }

  function select(place: PlaceResult) {
    setQuery(place.label);
    setOpen(false);
    setResults([]);
    onSelect(place);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="text-faint absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            search(e.target.value);
          }}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
          }}
          placeholder={placeholder ?? "Search a place…"}
          aria-label={ariaLabel}
          className="field-control w-full py-1.5 pr-8 pl-8"
        />
        {loading && (
          <Loader2 className="text-faint absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 animate-spin" />
        )}
        {!loading && results.length > 0 && (
          <ChevronDown className="text-faint absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2" />
        )}
      </div>
      {open && results.length > 0 && (
        <div
          role="listbox"
          className="border-hairline bg-surface absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border shadow-[var(--shadow-md)]"
        >
          {results.map((place, i) => (
            <button
              key={`${place.latitude}-${place.longitude}-${i}`}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => select(place)}
              className="hover:bg-subtle flex w-full items-start gap-2 px-3 py-2 text-left"
            >
              <MapPin className="text-muted mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0">
                <span className="text-body-xs text-ink block truncate">{place.label}</span>
                <span className="text-data-xs text-muted">
                  {place.latitude.toFixed(4)}, {place.longitude.toFixed(4)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      {open && results.length === 0 && !loading && query.trim().length >= 2 && (
        <div className="border-hairline bg-surface absolute z-20 mt-1 w-full rounded-md border px-3 py-4 text-center shadow-[var(--shadow-md)]">
          <p className="text-body-xs text-muted">No places found. Try a different search.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TripStopBuilder
// ---------------------------------------------------------------------------

export interface StopBuilderProps {
  stops: TripStop[];
  onStopsChange: (stops: TripStop[]) => void;
  routeLegs: RouteLeg[] | null;
  routeStale: boolean;
  onCalculateRoute?: () => void;
  calculating?: boolean;
  providerConfigured?: boolean;
}

export function TripStopBuilder({
  stops,
  onStopsChange,
  routeLegs,
  routeStale,
  onCalculateRoute,
  calculating = false,
  providerConfigured = true,
}: StopBuilderProps) {
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (stops.length === 0) {
      onStopsChange([makeStop(0, "ORIGIN"), makeStop(1, "DESTINATION")]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track which stops show manual coordinates
  const [manualCoordStops, setManualCoordStops] = useState<Set<string>>(new Set());

  const hasCoords = useMemo(
    () => stops.filter((s) => s.latitude != null && s.longitude != null).length >= 2,
    [stops],
  );

  const addStop = useCallback(() => {
    const newStops = [...stops];
    const insertAt = Math.max(1, newStops.length - 1);
    newStops.splice(insertAt, 0, makeStop(insertAt, "INTERMEDIATE"));
    const resequenced = newStops.map((s, i) => ({
      ...s,
      sequence: i,
      type:
        i === 0
          ? ("ORIGIN" as const)
          : i === newStops.length - 1
            ? ("DESTINATION" as const)
            : ("INTERMEDIATE" as const),
    }));
    onStopsChange(resequenced);
  }, [stops, onStopsChange]);

  const removeStop = useCallback(
    (index: number) => {
      if (stops.length <= 2) return;
      const removedId = stops[index]?.id;
      if (removedId) {
        setManualCoordStops((prev) => {
          const next = new Set(prev);
          next.delete(removedId);
          return next;
        });
      }
      const newStops = stops
        .filter((_, i) => i !== index)
        .map((s, i) => ({
          ...s,
          sequence: i,
          type:
            i === 0
              ? ("ORIGIN" as const)
              : i === stops.length - 2
                ? ("DESTINATION" as const)
                : ("INTERMEDIATE" as const),
        }));
      onStopsChange(newStops);
    },
    [stops, onStopsChange],
  );

  const moveStop = useCallback(
    (index: number, direction: -1 | 1) => {
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= stops.length) return;
      if (index === 0 && direction === -1) return;
      if (index === stops.length - 1 && direction === 1) return;
      const newStops = [...stops];
      [newStops[index], newStops[newIndex]] = [newStops[newIndex], newStops[index]];
      const resequenced = newStops.map((s, i) => ({
        ...s,
        sequence: i,
        type:
          i === 0
            ? ("ORIGIN" as const)
            : i === newStops.length - 1
              ? ("DESTINATION" as const)
              : ("INTERMEDIATE" as const),
      }));
      onStopsChange(resequenced);
    },
    [stops, onStopsChange],
  );

  const updateStop = useCallback(
    (index: number, updates: Partial<TripStop>) => {
      const newStops = stops.map((s, i) => (i === index ? { ...s, ...updates } : s));
      onStopsChange(newStops);
    },
    [stops, onStopsChange],
  );

  const addReturnToOrigin = useCallback(() => {
    if (stops.length < 2) return;
    const origin = stops[0];
    if (!origin) return;
    const newStops = [
      ...stops,
      {
        ...makeStop(stops.length, "DESTINATION", origin.label),
        latitude: origin.latitude,
        longitude: origin.longitude,
        address: origin.address,
        placeId: origin.placeId,
      },
    ];
    newStops[newStops.length - 2] = {
      ...newStops[newStops.length - 2],
      type: "INTERMEDIATE",
    };
    const resequenced = newStops.map((s, i) => ({ ...s, sequence: i }));
    onStopsChange(resequenced);
  }, [stops, onStopsChange]);

  const toggleManualCoords = useCallback((stopId: string) => {
    setManualCoordStops((prev) => {
      const next = new Set(prev);
      if (next.has(stopId)) next.delete(stopId);
      else next.add(stopId);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="field-label">Ordered stops</p>
        <div className="flex gap-2">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={addReturnToOrigin}
            title="Add a stop matching the origin"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Return
          </Button>
          <Button type="button" size="xs" variant="secondary" onClick={addStop}>
            <Plus className="h-3.5 w-3.5" />
            Add stop
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {stops.map((stop, index) => {
          const leg = routeLegs?.[index] ?? null;
          const isFirst = index === 0;
          const isLast = index === stops.length - 1;
          const typeLabel = isFirst ? "Origin" : isLast ? "Destination" : `Stop ${index}`;
          const showManual = manualCoordStops.has(stop.id);

          return (
            <div key={stop.id} className="flex flex-col gap-1.5">
              <div className="border-hairline bg-surface flex items-start gap-2 rounded-md border p-3">
                <div className="flex flex-col items-center gap-0.5 pt-1">
                  <button
                    type="button"
                    onClick={() => moveStop(index, -1)}
                    disabled={isFirst}
                    aria-label={`Move ${typeLabel} up`}
                    className="text-muted hover:text-ink disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <span className="text-data-xs text-muted font-mono">{index + 1}</span>
                  <button
                    type="button"
                    onClick={() => moveStop(index, 1)}
                    disabled={isLast}
                    aria-label={`Move ${typeLabel} down`}
                    className="text-muted hover:text-ink disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <MapPin
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isFirst ? "text-accent" : isLast ? "text-success" : "text-muted",
                      )}
                    />
                    <span className="text-body-xs text-muted font-medium">{typeLabel}</span>
                    {!isFirst && !isLast && (
                      <select
                        value={stop.purpose ?? ""}
                        onChange={(e) => updateStop(index, { purpose: e.target.value || null })}
                        className="text-body-xs border-hairline ml-auto rounded border px-1.5 py-0.5"
                        aria-label="Stop purpose"
                      >
                        <option value="">Purpose…</option>
                        {STOP_PURPOSES.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    )}
                    {stops.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeStop(index)}
                        aria-label={`Remove ${typeLabel}`}
                        className="text-muted hover:text-error ml-auto shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Location search — replaces manual coordinate entry */}
                  <PlaceSearch
                    value={stop.label}
                    onSelect={(place) =>
                      updateStop(index, {
                        label: place.label,
                        latitude: place.latitude,
                        longitude: place.longitude,
                        placeId: place.placeId ?? null,
                      })
                    }
                    placeholder={
                      isFirst
                        ? "Starting point (e.g. Accra Office)"
                        : isLast
                          ? "Destination (e.g. Cape Coast)"
                          : "Search a place…"
                    }
                    ariaLabel={`${typeLabel} location`}
                  />

                  {/* Selected coordinates indicator */}
                  {stop.latitude != null && stop.longitude != null && !showManual && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-data-xs text-muted">
                        {stop.latitude.toFixed(5)}, {stop.longitude.toFixed(5)}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleManualCoords(stop.id)}
                        className="text-muted hover:text-ink"
                        aria-label="Edit coordinates manually"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </div>
                  )}

                  {/* Manual coordinate fallback */}
                  {(showManual || (stop.latitude == null && stop.longitude == null)) && (
                    <div className="flex flex-col gap-2">
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          type="number"
                          step="any"
                          value={stop.latitude ?? ""}
                          onChange={(e) =>
                            updateStop(index, {
                              latitude: e.target.value ? Number(e.target.value) : null,
                              longitude: stop.longitude ?? null,
                            })
                          }
                          placeholder="Latitude"
                          aria-label={`${typeLabel} latitude`}
                        />
                        <Input
                          type="number"
                          step="any"
                          value={stop.longitude ?? ""}
                          onChange={(e) =>
                            updateStop(index, {
                              latitude: stop.latitude ?? null,
                              longitude: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                          placeholder="Longitude"
                          aria-label={`${typeLabel} longitude`}
                        />
                      </div>
                      {stop.latitude != null && stop.longitude != null && showManual && (
                        <button
                          type="button"
                          onClick={() => toggleManualCoords(stop.id)}
                          className="text-body-xs text-link self-start"
                        >
                          Use search instead
                        </button>
                      )}
                    </div>
                  )}

                  {/* Optional notes */}
                  <Input
                    value={stop.notes ?? ""}
                    onChange={(e) => updateStop(index, { notes: e.target.value || null })}
                    placeholder="Notes (optional)"
                    aria-label={`${typeLabel} notes`}
                    className="text-body-xs"
                  />
                </div>
              </div>

              {/* Leg distance indicator */}
              {leg && (
                <div className="text-body-xs text-muted flex items-center gap-1.5 pl-12">
                  <span className="border-hairline inline-block h-4 w-px border-l" />
                  <span>
                    {(leg.distanceM / 1000).toFixed(1)} km
                    {leg.durationS != null && <> · {Math.round(leg.durationS / 60)} min</>}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Route calculation controls */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {onCalculateRoute && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onCalculateRoute}
            disabled={calculating || !hasCoords}
            isLoading={calculating}
          >
            {calculating ? "Calculating…" : routeStale ? "Recalculate route" : "Calculate route"}
          </Button>
        )}
        {!providerConfigured && (
          <p className="text-body-xs text-warning">
            Routing provider not configured — enter coordinates to calculate manually.
          </p>
        )}
        {routeStale && (
          <p className="text-body-xs text-warning">
            Route is stale — stops changed after last calculation.
          </p>
        )}
      </div>
    </div>
  );
}
