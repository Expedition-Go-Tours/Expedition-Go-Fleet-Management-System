import { serverEnv } from "@/lib/env";
import {
  RoutingError,
  type GeoJsonLineString,
  type RouteLegResult,
  type RouteResult,
  type RouteWaypoint,
  type RoutingProvider,
} from "./provider";

/**
 * Mapbox Directions API integration.
 *
 * Uses the `driving` profile to calculate road distances and durations
 * between waypoints. Supports 2–25 waypoints per request (Mapbox limit).
 */

/** Timeout for Mapbox API requests (10 seconds). */
const REQUEST_TIMEOUT_MS = 10_000;

export class MapboxRoutingProvider implements RoutingProvider {
  readonly name = "mapbox";
  private token: string;

  constructor(token?: string) {
    this.token = token ?? "";
  }

  async calculateRoute(waypoints: RouteWaypoint[]): Promise<RouteResult> {
    if (!this.token) {
      throw RoutingError.notConfigured();
    }

    if (waypoints.length < 2) {
      throw RoutingError.invalidWaypoints(
        `At least 2 waypoints are required, got ${waypoints.length}`,
      );
    }
    if (waypoints.length > 25) {
      throw RoutingError.invalidWaypoints(
        `Mapbox supports at most 25 waypoints, got ${waypoints.length}`,
      );
    }

    // Build coordinate string: lon1,lat1;lon2,lat2;...
    const coords = waypoints.map((wp) => `${wp.longitude},${wp.latitude}`).join(";");
    const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${coords}`);
    url.searchParams.set("geometries", "geojson");
    url.searchParams.set("overview", "simplified");
    url.searchParams.set("steps", "false");
    url.searchParams.set("access_token", this.token);

    let response: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        response = await fetch(url.toString(), { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw RoutingError.timeout();
      }
      throw RoutingError.providerError(
        `Network error calling Mapbox: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (response.status === 429) {
      throw RoutingError.rateLimited();
    }
    if (!response.ok) {
      throw RoutingError.providerError(
        `Mapbox returned HTTP ${response.status}: ${await response.text().catch(() => "unknown")}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw RoutingError.providerError("Mapbox returned invalid JSON");
    }

    const data = body as {
      routes?: Array<{
        distance: number;
        duration: number;
        legs?: Array<{ distance: number; duration: number }>;
        geometry?: GeoJsonLineString;
      }>;
      code?: string;
      message?: string;
    };

    if (data.code && data.code !== "Ok") {
      if (data.code === "NoRoute") throw RoutingError.noRoute(data.message);
      throw RoutingError.providerError(`Mapbox error: ${data.code} - ${data.message ?? "unknown"}`);
    }

    const route = data.routes?.[0];
    if (!route) {
      throw RoutingError.noRoute();
    }

    const legs: RouteLegResult[] = (route.legs ?? []).map((leg) => ({
      distanceM: Math.round(leg.distance),
      durationS: Math.round(leg.duration),
    }));

    const geometry = route.geometry as GeoJsonLineString | undefined;

    return {
      totalDistanceM: Math.round(route.distance),
      totalDurationS: Math.round(route.duration),
      legs,
      provider: this.name,
      calculatedAt: new Date().toISOString(),
      geometry: geometry?.type === "LineString" ? geometry : undefined,
      providerMeta: {
        rawCode: data.code,
      },
    };
  }
}

/**
 * Get a Mapbox routing provider if configured, or null.
 * Returns null when MAPBOX_ACCESS_TOKEN is not set.
 */
export function getMapboxProvider(): RoutingProvider | null {
  const token = serverEnv.mapboxAccessToken;
  if (!token) return null;
  return new MapboxRoutingProvider(token);
}
