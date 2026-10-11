"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { ArrowDown, ArrowUp, MapPin, Plus, Trash2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/fields";

import type { TripStop, RouteLeg } from "@/lib/domain/trip";

/*
 * Interactive multi-stop route builder.
 *
 * Renders an ordered list of stops with add/remove/reorder controls and
 * optional coordinate fields. The parent owns the stops array; this
 * component calls `onStopsChange` whenever the list changes. Each stop
 * gets a stable ID so the route-calculation endpoint can correlate legs.
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

export interface StopBuilderProps {
  stops: TripStop[];
  onStopsChange: (stops: TripStop[]) => void;
  routeLegs: RouteLeg[] | null;
  routeStale: boolean;
  /** Called when the user requests a route calculation. */
  onCalculateRoute?: () => void;
  /** Whether a route calculation is currently in progress. */
  calculating?: boolean;
  /** Whether the route provider is configured. */
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
  // Ensure we always have at least an origin and destination.
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (stops.length === 0) {
      onStopsChange([makeStop(0, "ORIGIN"), makeStop(1, "DESTINATION")]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hasCoords = useMemo(
    () => stops.filter((s) => s.latitude != null && s.longitude != null).length >= 2,
    [stops],
  );

  const addStop = useCallback(() => {
    const newStops = [...stops];
    // Insert before the last stop (destination).
    const insertAt = Math.max(1, newStops.length - 1);
    newStops.splice(insertAt, 0, makeStop(insertAt, "INTERMEDIATE"));
    // Re-sequence.
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
      if (stops.length <= 2) return; // Need at least origin + destination.
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
      // Don't move origin past position 0 or destination past last position.
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
    const newStops = [...stops, makeStop(stops.length, "DESTINATION", origin.label)];
    // Re-type the previous last stop as intermediate.
    newStops[newStops.length - 2] = {
      ...newStops[newStops.length - 2],
      type: "INTERMEDIATE",
    };
    const resequenced = newStops.map((s, i) => ({ ...s, sequence: i }));
    onStopsChange(resequenced);
  }, [stops, onStopsChange]);

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
                    <MapPin className="text-muted h-4 w-4 shrink-0" />
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

                  <Input
                    value={stop.label}
                    onChange={(e) => updateStop(index, { label: e.target.value })}
                    placeholder={
                      isFirst
                        ? "Starting point (e.g. Accra Office)"
                        : isLast
                          ? "Destination (e.g. Cape Coast)"
                          : "Stop name or address"
                    }
                    aria-label={`${typeLabel} name`}
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      step="any"
                      value={stop.latitude ?? ""}
                      onChange={(e) =>
                        updateStop(index, {
                          latitude: e.target.value ? Number(e.target.value) : null,
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
                          longitude: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      placeholder="Longitude"
                      aria-label={`${typeLabel} longitude`}
                    />
                  </div>

                  <Input
                    value={stop.address ?? ""}
                    onChange={(e) => updateStop(index, { address: e.target.value || null })}
                    placeholder="Address (optional)"
                    aria-label={`${typeLabel} address`}
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
