import { getGeoapifyProvider } from "./geoapify";
import { getMapboxProvider } from "./mapbox";
import { MockRoutingProvider } from "./mock";
import type { RoutingProvider } from "./provider";
import { RoutingError } from "./provider";

/**
 * Get the configured routing provider.
 *
 * Priority: Geoapify (free tier) > Mapbox > Mock (dev only).
 * In production, a real provider is mandatory.
 */
export function getRoutingProvider(): RoutingProvider {
  // Try Geoapify first (free, open)
  const geoapify = getGeoapifyProvider();
  if (geoapify) return geoapify;

  // Try Mapbox as secondary
  const mapbox = getMapboxProvider();
  if (mapbox) return mapbox;

  if (process.env.NODE_ENV === "production") {
    throw RoutingError.notConfigured();
  }

  console.warn(
    "[routing] No routing provider configured (GEOAPIFY_API_KEY or MAPBOX_ACCESS_TOKEN). " +
      "Using mock routing provider. Route distances will be approximate Haversine × 1.3.",
  );
  return new MockRoutingProvider();
}

/**
 * Check whether a real routing provider is configured without throwing.
 */
export function isRoutingConfigured(): boolean {
  return !!(process.env.GEOAPIFY_API_KEY || process.env.MAPBOX_ACCESS_TOKEN);
}

export type { RouteLegResult, RouteResult, RouteWaypoint, RoutingProvider } from "./provider";
export { RoutingError } from "./provider";
