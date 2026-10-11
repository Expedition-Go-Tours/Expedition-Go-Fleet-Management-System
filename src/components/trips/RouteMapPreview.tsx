"use client";

import { useState } from "react";
import { MapPin, Route as RouteIcon } from "lucide-react";
import type { TripStop, RouteLeg } from "@/lib/domain/trip";

/**
 * Route map preview using Mapbox Static Images API.
 * Falls back gracefully when the map token is unavailable or tiles fail.
 * The stop list remains fully usable without the map.
 */
export function RouteMapPreview({
  stops,
  legs,
  totalDistanceKm,
  totalDurationS,
  provider,
}: {
  stops: TripStop[];
  legs: RouteLeg[];
  totalDistanceKm: number | null;
  totalDurationS: number | null;
  provider: string | null;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  // Build Mapbox Static Images URL
  // Requires NEXT_PUBLIC_MAPBOX_TOKEN to be set
  const mapboxToken =
    typeof window !== "undefined" ? process.env.NEXT_PUBLIC_MAPBOX_TOKEN : undefined;

  const hasCoords = stops.filter((s) => s.latitude != null && s.longitude != null).length >= 2;

  // Build path for static image: pin markers + path
  const staticImageUrl = buildStaticMapUrl(stops, mapboxToken);

  const showMap = mapboxToken && hasCoords && !imageFailed;

  return (
    <div className="border-hairline overflow-hidden rounded-md border">
      {/* Map or fallback */}
      {showMap ? (
        <div className="bg-subtle relative aspect-[16/9] w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={staticImageUrl}
            alt={`Route map showing ${stops.length} stops`}
            className="h-full w-full object-cover"
            onError={() => setImageFailed(true)}
          />
          {/* Provider attribution */}
          <span className="text-data-xs bg-surface/80 absolute right-1 bottom-1 rounded px-1 py-0.5">
            {provider ?? "Map"}
          </span>
        </div>
      ) : (
        <div className="bg-subtle flex flex-col items-center gap-2 py-6">
          <MapPin className="text-muted h-5 w-5" />
          <p className="text-body-xs text-muted">
            {!mapboxToken
              ? "Map preview requires NEXT_PUBLIC_MAPBOX_TOKEN"
              : !hasCoords
                ? "Add coordinates to at least 2 stops to see the route"
                : "Map preview unavailable"}
          </p>
        </div>
      )}

      {/* Route summary below the map */}
      <div className="border-hairline bg-surface flex flex-wrap items-center gap-4 border-t px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <RouteIcon className="text-accent h-4 w-4" />
          <span className="text-body-sm text-ink font-semibold">
            {totalDistanceKm?.toFixed(1) ?? "—"} km
          </span>
        </div>
        {totalDurationS != null && (
          <span className="text-body-xs text-muted">~{Math.round(totalDurationS / 60)} min</span>
        )}
        <span className="text-data-xs text-muted ml-auto">
          Route estimate — not GPS-tracked actual distance
        </span>
      </div>

      {/* Leg breakdown */}
      {legs.length > 0 && (
        <div className="divide-hairline divide-y">
          {stops.map((stop, i) => {
            const leg = legs[i] ?? null;
            return (
              <div key={stop.id} className="flex items-start gap-3 px-4 py-2">
                <div className="flex flex-col items-center gap-0.5 pt-0.5">
                  <MapPin
                    className={
                      i === 0
                        ? "text-accent h-3.5 w-3.5"
                        : i === stops.length - 1
                          ? "text-success h-3.5 w-3.5"
                          : "text-muted h-3.5 w-3.5"
                    }
                  />
                  {i < stops.length - 1 && <div className="border-hairline h-3 w-px border-l" />}
                </div>
                <span className="text-body-xs text-ink min-w-0 flex-1 truncate">
                  {stop.label || `Stop ${i + 1}`}
                </span>
                {leg && (
                  <span className="text-data-xs text-muted shrink-0">
                    {(leg.distanceM / 1000).toFixed(1)} km
                    {leg.durationS != null && ` · ${Math.round(leg.durationS / 60)} min`}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function buildStaticMapUrl(stops: TripStop[], token: string | undefined): string {
  if (!token) return "";
  const coords = stops
    .filter((s) => s.latitude != null && s.longitude != null)
    .map((s) => `${s.longitude!.toFixed(5)},${s.latitude!.toFixed(5)}`);
  if (coords.length < 2) return "";

  // Path: red line connecting all stops
  const path = `path-3+f44-0.7(${coords.join("|")})`;

  // Markers: numbered pins
  const markers = stops
    .filter((s) => s.latitude != null && s.longitude != null)
    .map((s, i) => {
      const label = i === 0 ? "A" : i === stops.length - 1 ? "B" : String(i);
      const color = i === 0 ? "00cc66" : i === stops.length - 1 ? "ff3333" : "4488ff";
      return `pin-s-${label}+${color}(${s.longitude!.toFixed(5)},${s.latitude!.toFixed(5)})`;
    })
    .join(",");

  const encoded = encodeURIComponent(`${path},${markers}`);
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${encoded}/auto/600x300@2x?access_token=${token}`;
}
