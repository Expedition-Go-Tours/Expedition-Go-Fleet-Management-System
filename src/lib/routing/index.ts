import { getMapboxProvider } from "./mapbox";
import { MockRoutingProvider } from "./mock";
import type { RoutingProvider } from "./provider";

/**
 * Get the configured routing provider.
 *
 * Returns MapboxRoutingProvider if MAPBOX_ACCESS_TOKEN is set,
 * MockRoutingProvider otherwise. Logs a warning when falling back to mock
 * in production.
 */
export function getRoutingProvider(): RoutingProvider {
  const mapbox = getMapboxProvider();
  if (mapbox) return mapbox;

  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[routing] MAPBOX_ACCESS_TOKEN is not set; using mock routing provider. " +
        "Route distances will be approximate Haversine × 1.3 and should NOT be used for billing.",
    );
  }

  return new MockRoutingProvider();
}

export type { RouteLegResult, RouteResult, RouteWaypoint, RoutingProvider } from "./provider";
export { RoutingError } from "./provider";
