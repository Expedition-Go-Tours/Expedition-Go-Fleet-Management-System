"use client";

import { Clock, MapPin, Route } from "lucide-react";
import type { RouteLeg, TripStop } from "@/lib/domain/trip";

/*
 * Route summary: shows ordered stops, per-leg distances, and total.
 * Pure presentational — no API calls.
 */

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

export function RouteSummary({
  stops,
  legs,
  totalDistanceM,
  totalDurationS,
  provider,
  calculatedAt,
  stale,
}: {
  stops: TripStop[];
  legs: RouteLeg[];
  totalDistanceM: number | null;
  totalDurationS: number | null;
  provider: string | null;
  calculatedAt: string | null;
  stale: boolean;
}) {
  if (!totalDistanceM || legs.length === 0) return null;

  const totalKm = (totalDistanceM / 1000).toFixed(1);

  return (
    <div className="border-hairline bg-surface rounded-md border">
      <div className="border-hairline flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
        <Route className="text-accent h-4 w-4" />
        <div className="flex items-center gap-2">
          <span className="text-body-sm text-ink font-semibold">{totalKm} km</span>
          {totalDurationS != null && (
            <span className="text-body-xs text-muted">
              <Clock className="mr-1 inline h-3 w-3" />
              {formatDuration(totalDurationS)}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {stale && <span className="text-body-xs text-warning font-medium">Stale</span>}
          {provider && <span className="text-data-xs text-muted">via {provider}</span>}
        </div>
      </div>

      <ul className="divide-hairline divide-y">
        {stops.map((stop, i) => {
          const leg = legs[i] ?? null;
          return (
            <li key={stop.id} className="flex items-start gap-3 px-4 py-2.5">
              <div className="flex flex-col items-center gap-0.5 pt-0.5">
                <MapPin
                  className={
                    i === 0
                      ? "text-accent h-4 w-4"
                      : i === stops.length - 1
                        ? "text-success h-4 w-4"
                        : "text-muted h-4 w-4"
                  }
                />
                {i < stops.length - 1 && <div className="border-hairline h-4 w-px border-l" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-body-xs text-ink font-medium">{stop.label || `Stop ${i + 1}`}</p>
                {stop.latitude != null && stop.longitude != null && (
                  <p className="text-data-xs text-muted">
                    {stop.latitude.toFixed(5)}, {stop.longitude.toFixed(5)}
                  </p>
                )}
                {leg && (
                  <p className="text-data-xs text-muted mt-0.5">
                    → {(leg.distanceM / 1000).toFixed(1)} km
                    {leg.durationS != null && ` · ${formatDuration(leg.durationS)}`}
                  </p>
                )}
              </div>
              {stop.purpose && (
                <span className="text-data-xs bg-subtle text-muted rounded px-1.5 py-0.5">
                  {stop.purpose}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="border-hairline bg-subtle flex items-center justify-between border-t px-4 py-2">
        <span className="text-body-xs text-muted">
          Route estimate — not GPS-tracked actual distance
        </span>
        {calculatedAt && (
          <span className="text-data-xs text-muted">
            {new Date(calculatedAt).toLocaleString("en-GB", {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>
    </div>
  );
}
