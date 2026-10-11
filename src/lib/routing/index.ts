import { getMapboxProvider } from "./mapbox";
import { MockRoutingProvider } from "./mock";
import type { RoutingProvider } from "./provider";
import { RoutingError } from "./provider";

/**
 * Get the configured routing provider.
 *
 * In production, a real provider (Mapbox) is mandatory. The mock provider
 * is only allowed in development and test environments.
 */
export function getRoutingProvider(): RoutingProvider {
  const mapbox = getMapboxProvider();
  if (mapbox) return mapbox;

  if (process.env.NODE_ENV === "production") {
    throw RoutingError.notConfigured();
  }

  console.warn(
    "[routing] MAPBOX_ACCESS_TOKEN is not set; using mock routing provider. " +
      "Route distances will be approximate Haversine × 1.3 and should NOT be used for billing.",
  );
  return new MockRoutingProvider();
}

/**
 * Check whether a real routing provider is configured without throwing.
 * Useful for health checks and UI indicators.
 */
export function isRoutingConfigured(): boolean {
  return !!process.env.MAPBOX_ACCESS_TOKEN;
}

export type { RouteLegResult, RouteResult, RouteWaypoint, RoutingProvider } from "./provider";
export { RoutingError } from "./provider";
