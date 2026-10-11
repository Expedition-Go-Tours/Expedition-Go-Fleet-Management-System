import {
  RoutingError,
  type RouteResult,
  type RouteWaypoint,
  type RoutingProvider,
} from "./provider";

/**
 * Mock routing provider for development and testing.
 *
 * Returns deterministic distances based on waypoint coordinates using a
 * simple Haversine formula (straight-line distance × 1.3 as a rough road
 * factor). The road factor accounts for the reality that driving routes are
 * longer than straight-line distances, particularly in Ghana where road
 * networks follow coastlines and avoid terrain.
 */

/** Haversine distance in metres between two lat/lng points. */
export function haversineDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000; // Earth radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Rough road-distance factor applied to straight-line distances. */
const ROAD_FACTOR = 1.3;

export class MockRoutingProvider implements RoutingProvider {
  readonly name = "mock";

  async calculateRoute(waypoints: RouteWaypoint[]): Promise<RouteResult> {
    if (waypoints.length < 2) {
      throw RoutingError.invalidWaypoints(
        `At least 2 waypoints are required, got ${waypoints.length}`,
      );
    }

    const legs: { distanceM: number; durationS: number }[] = [];
    let totalDistanceM = 0;

    for (let i = 0; i < waypoints.length - 1; i++) {
      const from = waypoints[i];
      const to = waypoints[i + 1];
      const straightLineM = haversineDistanceM(
        from.latitude,
        from.longitude,
        to.latitude,
        to.longitude,
      );
      const roadDistanceM = Math.round(straightLineM * ROAD_FACTOR);
      // Assume average speed of 50 km/h for duration estimate
      const durationS = Math.round((roadDistanceM / 1000 / 50) * 3600);

      legs.push({ distanceM: roadDistanceM, durationS });
      totalDistanceM += roadDistanceM;
    }

    const totalDurationS = legs.reduce((sum, leg) => sum + leg.durationS, 0);

    // Build approximate geometry as a straight-line GeoJSON between waypoints
    const coordinates: [number, number][] = waypoints.map((wp) => [wp.longitude, wp.latitude]);

    return {
      totalDistanceM,
      totalDurationS,
      legs,
      provider: this.name,
      calculatedAt: new Date().toISOString(),
      geometry: { type: "LineString", coordinates },
    };
  }
}
