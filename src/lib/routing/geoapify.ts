import {
  RoutingError,
  type GeoJsonLineString,
  type RouteLegResult,
  type RouteResult,
  type RouteWaypoint,
  type RoutingProvider,
} from "./provider";

/**
 * Geoapify Routing API integration.
 *
 * Free tier: 3,000 requests/day.
 * API docs: https://apidocs.geoapify.com/docs/routing/
 *
 * Geoapify returns distances in metres and times in SECONDS.
 * Supports chunking for routes with more than MAX_WAYPOINTS stops.
 */

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_WAYPOINTS = 25;

function chunkWaypoints(waypoints: RouteWaypoint[], max: number): RouteWaypoint[][] {
  if (waypoints.length <= max) return [waypoints];
  const chunks: RouteWaypoint[][] = [];
  for (let start = 0; start < waypoints.length - 1; start += max - 1) {
    const end = Math.min(start + max, waypoints.length);
    chunks.push(waypoints.slice(start, end));
  }
  return chunks;
}

export class GeoapifyRoutingProvider implements RoutingProvider {
  readonly name = "geoapify";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async calculateRoute(waypoints: RouteWaypoint[]): Promise<RouteResult> {
    if (waypoints.length < 2) {
      throw RoutingError.invalidWaypoints(
        `At least 2 waypoints are required, got ${waypoints.length}`,
      );
    }

    const chunks = chunkWaypoints(waypoints, MAX_WAYPOINTS);
    const allLegs: RouteLegResult[] = [];
    const allGeometryCoords: [number, number][] = [];
    let totalDistanceM = 0;
    let totalDurationS = 0;

    for (const chunk of chunks) {
      const result = await this.calculateSingleRoute(chunk);
      totalDistanceM += result.totalDistanceM;
      totalDurationS += result.totalDurationS;
      for (const leg of result.legs) {
        allLegs.push(leg);
      }

      if (result.geometry) {
        const coords = result.geometry.coordinates;
        if (allGeometryCoords.length > 0 && coords.length > 0) {
          const lastExisting = allGeometryCoords[allGeometryCoords.length - 1];
          const firstNew = coords[0];
          if (
            lastExisting &&
            firstNew &&
            lastExisting[0] === firstNew[0] &&
            lastExisting[1] === firstNew[1]
          ) {
            allGeometryCoords.push(...coords.slice(1));
          } else {
            allGeometryCoords.push(...coords);
          }
        } else {
          allGeometryCoords.push(...coords);
        }
      }
    }

    return {
      totalDistanceM,
      totalDurationS,
      legs: allLegs,
      provider: this.name,
      calculatedAt: new Date().toISOString(),
      geometry:
        allGeometryCoords.length > 1
          ? { type: "LineString", coordinates: allGeometryCoords }
          : undefined,
      providerMeta: { mode: "drive", chunks: chunks.length },
    };
  }

  private async calculateSingleRoute(waypoints: RouteWaypoint[]): Promise<RouteResult> {
    if (waypoints.length > MAX_WAYPOINTS) {
      throw RoutingError.invalidWaypoints(
        `Geoapify supports at most ${MAX_WAYPOINTS} waypoints per request`,
      );
    }

    const waypointsStr = waypoints.map((wp) => `${wp.latitude},${wp.longitude}`).join("|");
    const url = new URL("https://api.geoapify.com/v1/routing");
    url.searchParams.set("waypoints", waypointsStr);
    url.searchParams.set("mode", "drive");
    url.searchParams.set("type", "short");
    url.searchParams.set("apiKey", this.apiKey);

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
        `Network error calling Geoapify: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (response.status === 429) {
      throw RoutingError.rateLimited();
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "unknown");
      throw RoutingError.providerError(`Geoapify returned HTTP ${response.status}: ${text}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw RoutingError.providerError("Geoapify returned invalid JSON");
    }

    const data = body as {
      type?: string;
      features?: Array<{
        properties?: {
          distance?: number;
          time?: number;
          legs?: Array<{
            distance?: number;
            time?: number;
            steps?: unknown[];
          }>;
        };
        geometry?: {
          type?: string;
          coordinates?: [number, number][];
        };
      }>;
    };

    const route = data.features?.[0];
    if (!route) {
      throw RoutingError.noRoute("Geoapify returned no route for the given waypoints");
    }

    const props = route.properties ?? {};
    // Geoapify returns distance in metres and time in SECONDS.
    const totalDistanceM = Math.round(props.distance ?? 0);
    const totalDurationS = Math.round(props.time ?? 0);

    const legs: RouteLegResult[] = (props.legs ?? []).map((leg) => ({
      distanceM: Math.round(leg.distance ?? 0),
      durationS: Math.round(leg.time ?? 0),
    }));

    let geometry: GeoJsonLineString | undefined;
    if (route.geometry?.type === "LineString" && Array.isArray(route.geometry.coordinates)) {
      geometry = {
        type: "LineString",
        coordinates: route.geometry.coordinates as [number, number][],
      };
    }

    return {
      totalDistanceM,
      totalDurationS,
      legs,
      provider: this.name,
      calculatedAt: new Date().toISOString(),
      geometry,
      providerMeta: { mode: "drive" },
    };
  }
}

export function getGeoapifyProvider(): RoutingProvider | null {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key) return null;
  return new GeoapifyRoutingProvider(key);
}
