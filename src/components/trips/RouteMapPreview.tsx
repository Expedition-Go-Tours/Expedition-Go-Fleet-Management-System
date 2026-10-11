"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Route as RouteIcon } from "lucide-react";
import type { TripStop, RouteLeg } from "@/lib/domain/trip";
import type { GeoJsonLineString } from "@/lib/routing/provider";

/**
 * Route map preview using MapLibre GL + OpenFreeMap tiles.
 *
 * OpenFreeMap provides free OpenStreetMap-based vector tiles with no API key.
 * MapLibre GL JS renders the interactive map with route line and markers.
 * Falls back gracefully when the JS library fails to load.
 */
export function RouteMapPreview({
  stops,
  legs,
  totalDistanceKm,
  totalDurationS,
  provider,
  routeGeometry,
}: {
  stops: TripStop[];
  legs: RouteLeg[];
  totalDistanceKm: number | null;
  totalDurationS: number | null;
  provider: string | null;
  routeGeometry?: GeoJsonLineString | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<unknown>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  const coordStops = stops.filter((s) => s.latitude != null && s.longitude != null);
  const hasCoords = coordStops.length >= 2;

  // Initialize MapLibre GL map
  useEffect(() => {
    if (!containerRef.current || !hasCoords || mapFailed) return;

    let cancelled = false;

    async function initMap() {
      try {
        const maplibregl = (await import("maplibre-gl")).default;

        if (cancelled || !containerRef.current) return;

        // OpenFreeMap vector tiles — free, no key
        const map = new maplibregl.Map({
          container: containerRef.current!,
          style: "https://tiles.openfreemap.org/styles/liberty",
          center: [coordStops[0]!.longitude!, coordStops[0]!.latitude!],
          zoom: 10,
        });

        map.addControl(new maplibregl.NavigationControl(), "top-right");

        map.on("load", () => {
          if (cancelled) return;

          // Fit bounds to all stops
          const bounds = new maplibregl.LngLatBounds();
          for (const stop of coordStops) {
            bounds.extend([stop.longitude!, stop.latitude!]);
          }
          map.fitBounds(bounds, { padding: 50 });

          // Add route line only when actual road geometry is available.
          // Straight-line connections between stops misrepresent driving routes.
          if (routeGeometry?.coordinates && routeGeometry.coordinates.length > 1) {
            map.addSource("route", {
              type: "geojson",
              data: {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates: routeGeometry.coordinates,
                },
              },
            });

            map.addLayer({
              id: "route-line",
              type: "line",
              source: "route",
              layout: {
                "line-join": "round",
                "line-cap": "round",
              },
              paint: {
                "line-color": "#f15a24",
                "line-width": 4,
                "line-opacity": 0.85,
              },
            });
          }

          // Add stop markers
          coordStops.forEach((stop, i) => {
            const el = document.createElement("div");
            el.className = "trip-map-marker";
            el.style.cssText = `
              width: 28px; height: 28px; border-radius: 50%;
              background: ${i === 0 ? "#15803d" : i === coordStops.length - 1 ? "#d92d20" : "#1a1d21"};
              color: white; display: flex; align-items: center; justify-content: center;
              font-size: 12px; font-weight: 600; font-family: var(--font-body);
              border: 2px solid white; box-shadow: 0 1px 4px rgba(0,0,0,0.3);
            `;
            el.textContent = String(i + 1);

            new maplibregl.Marker({ element: el })
              .setLngLat([stop.longitude!, stop.latitude!])
              .setPopup(
                new maplibregl.Popup({ offset: 20 }).setDOMContent(
                  (() => {
                    const frag = document.createDocumentFragment();
                    const strong = document.createElement("strong");
                    strong.textContent = stop.label || `Stop ${i + 1}`;
                    frag.appendChild(strong);
                    if (stop.purpose) {
                      const br = document.createElement("br");
                      frag.appendChild(br);
                      const small = document.createElement("small");
                      small.textContent = stop.purpose;
                      frag.appendChild(small);
                    }
                    return frag;
                  })(),
                ),
              )
              .addTo(map);
          });

          setMapReady(true);
        });

        map.on("error", () => {
          if (!cancelled) setMapFailed(true);
        });

        mapRef.current = map;
      } catch {
        if (!cancelled) setMapFailed(true);
      }
    }

    initMap();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        (mapRef.current as { remove(): void }).remove();
        mapRef.current = null;
      }
    };
  }, [hasCoords, coordStops, routeGeometry, mapFailed]);

  return (
    <div className="border-hairline overflow-hidden rounded-md border">
      {/* Map container */}
      {hasCoords && !mapFailed ? (
        <div className="relative w-full" style={{ aspectRatio: "16/9" }}>
          <div ref={containerRef} className="absolute inset-0" />
          {!mapReady && (
            <div className="bg-subtle absolute inset-0 flex items-center justify-center">
              <Loader2 className="text-muted h-5 w-5 animate-spin" />
            </div>
          )}
          {/* Provider attribution */}
          <span className="text-data-xs bg-surface/80 absolute right-1 bottom-1 z-10 rounded px-1 py-0.5">
            {provider ?? "Route"} · OpenFreeMap
          </span>
        </div>
      ) : (
        <div className="bg-subtle flex flex-col items-center gap-2 py-6">
          <MapPin className="text-muted h-5 w-5" />
          <p className="text-body-xs text-muted">
            {!hasCoords
              ? "Add coordinates to at least 2 stops to see the route"
              : "Map preview unavailable"}
          </p>
        </div>
      )}

      {/* Route summary */}
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
