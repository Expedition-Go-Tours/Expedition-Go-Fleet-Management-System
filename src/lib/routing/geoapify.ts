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
 * Uses the 'drive' mode for car/van routing.
 * Returns GeoJSON route geometry for map display.
 */

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_WAYPOINTS = 25;

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
    if (waypoints.length > MAX_WAYPOINTS) {
      throw RoutingError.invalidWaypoints(
        `Geoapify supports at most ${MAX_WAYPOINTS} waypoints, got ${waypoints.length}`,
      );
    }

    // Geoapify expects waypoints as lat,lon pairs separated by |
    const waypointsStr = waypoints.map((wp) => `${wp.latitude},${wp.longitude}`).join("|");

    const url = new URL("https://api.geoapify.com/v1/routing");
    url.searchParams.set("waypoints", waypointsStr);
    url.searchParams.set("mode", "drive");
    url.searchParams.set("type", "short"); // shortest practical route
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
    const totalDistanceM = Math.round(props.distance ?? 0);
    const totalDurationS = Math.round((props.time ?? 0) / 1000); // Geoapify time is in ms

    const legs: RouteLegResult[] = (props.legs ?? []).map((leg) => ({
      distanceM: Math.round(leg.distance ?? 0),
      durationS: Math.round((leg.time ?? 0) / 1000),
    }));

    // Do NOT fabricate per-leg distances by dividing the total evenly.
    // Two legs of a multi-stop journey may have very different lengths.
    // If the provider does not supply leg data, leave legs empty and let
    // callers use totalDistanceM/totalDurationS for the overall trip.
    // Leg distances are only usable when explicitly returned by the provider.

    // Extract GeoJSON geometry
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
      providerMeta: {
        mode: "drive",
      },
    };
  }
}

/**
 * Get a Geoapify routing provider if configured, or null.
 */
export function getGeoapifyProvider(): RoutingProvider | null {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key) return null;
  return new GeoapifyRoutingProvider(key);
}
