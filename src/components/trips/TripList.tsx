"use client";

import Link from "next/link";
import { MapPin, Route, Clock } from "lucide-react";

import { StatusBadge } from "@/components/ui/StatusBadge";
import { humanizeEnum } from "@/lib/format";
import type { Trip } from "@/lib/domain/trip";

/*
 * Daily trip list: shows all trips recorded for a given date.
 * Pure presentational — the parent fetches trips via the server page.
 */

export function TripList({
  trips,
  emptyMessage = "No trips recorded for this date.",
}: {
  trips: Trip[];
  emptyMessage?: string;
}) {
  if (trips.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <Route className="text-muted h-6 w-6" />
        <p className="text-body-xs text-muted">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <ul className="divide-hairline divide-y">
      {trips.map((trip) => {
        const distanceKm =
          trip.routeDistanceKm ??
          (trip.actualDistanceKm ? trip.actualDistanceKm : trip.manualDistanceKm);
        const distanceLabel = distanceKm != null ? `${distanceKm.toFixed(1)} km` : "No distance";
        const basisLabel =
          trip.distanceBasis === "ACTUAL_ODOMETER"
            ? "Actual"
            : trip.distanceBasis === "MANUAL_OVERRIDE"
              ? "Manual"
              : "Estimate";

        return (
          <li key={trip.id}>
            <Link
              href={`/trips/${trip.id}`}
              className="hover:bg-subtle flex flex-col gap-2 px-5 py-3 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-body-sm text-ink font-medium">
                    {trip.origin.label} → {trip.destination.label}
                  </p>
                  <p className="text-body-xs text-muted mt-0.5">
                    {humanizeEnum(trip.purpose)}
                    {trip.externalReference && ` · ${trip.externalReference}`}
                    {trip.stops.length > 2 && ` · ${trip.stops.length} stops`}
                  </p>
                </div>
                <StatusBadge status={trip.status} />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span className="text-data-xs text-muted flex items-center gap-1">
                  <Route className="h-3 w-3" />
                  {distanceLabel}
                  <span className="text-faint">({basisLabel})</span>
                </span>
                {trip.routeDurationS != null && (
                  <span className="text-data-xs text-muted flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {Math.round(trip.routeDurationS / 60)} min
                  </span>
                )}
                {trip.stops.length > 2 && (
                  <span className="text-data-xs text-muted flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {trip.stops.length} stops
                  </span>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/*
 * Compact trip summary for the vehicle profile.
 */
export function VehicleTripSummary({ trips }: { trips: Trip[]; vehicleId: string }) {
  const completed = trips.filter((t) => t.status === "COMPLETED");
  const totalDistanceM = completed.reduce((sum, t) => {
    if (t.routeDistanceM && t.routeDistanceM > 0) return sum + t.routeDistanceM;
    if (t.actualDistanceKm && t.actualDistanceKm > 0)
      return sum + Math.round(t.actualDistanceKm * 1000);
    if (t.manualDistanceKm && t.manualDistanceKm > 0)
      return sum + Math.round(t.manualDistanceKm * 1000);
    return sum;
  }, 0);
  const totalKm = (totalDistanceM / 1000).toFixed(1);

  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Route className="text-muted h-4 w-4" />
          <span className="text-body-sm text-ink font-medium">
            {completed.length} completed trips
          </span>
        </div>
        <span className="text-body-xs text-muted">{totalKm} km total estimated distance</span>
      </div>
      <TripList trips={trips.slice(0, 10)} emptyMessage="No trips recorded for this vehicle." />
      {trips.length > 10 && (
        <p className="text-body-xs text-muted text-center">Showing 10 of {trips.length} trips.</p>
      )}
    </div>
  );
}
