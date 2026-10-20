import { getGeoapifyProvider } from "./geoapify";
import { getMapboxProvider } from "./mapbox";
import { MockRoutingProvider } from "./mock";
import type { RoutingProvider } from "./provider";

/**
 * Get the configured routing provider.
 *
 * Priority: Geoapify (free tier) > Mapbox > approximate fallback.
 *
 * This **never throws**. A missing third-party key must not take down trip
 * recording — a small operator who has not yet signed up for a routing service
 * should still be able to log journeys. With no key configured we fall back to
 * straight-line distance scaled by a road factor, and the result is flagged
 * `approximate: true` so the UI can say so.
 */
/** Log the fallback warning once per process, not on every route calculation. */
let warnedMissingProvider = false;

export function getRoutingProvider(): RoutingProvider {
  // Try Geoapify first (free, open)
  const geoapify = getGeoapifyProvider();
  if (geoapify) return geoapify;

  // Try Mapbox as secondary
  const mapbox = getMapboxProvider();
  if (mapbox) return mapbox;

  if (!warnedMissingProvider) {
    warnedMissingProvider = true;
    console.warn(
      "[routing] No routing provider configured (GEOAPIFY_API_KEY or MAPBOX_ACCESS_TOKEN). " +
        "Distances are approximate: straight-line × 1.3 road factor. Set a key for real routes.",
    );
  }
  return new MockRoutingProvider();
}

/**
 * Check whether a real routing provider is configured. When false, distances are
 * approximate — the app still works, it just says so.
 */
export function isRoutingConfigured(): boolean {
  return !!(process.env.GEOAPIFY_API_KEY || process.env.MAPBOX_ACCESS_TOKEN);
}

export type { RouteLegResult, RouteResult, RouteWaypoint, RoutingProvider } from "./provider";
export { RoutingError } from "./provider";
