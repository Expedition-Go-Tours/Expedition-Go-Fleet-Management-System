/**
 * Routing provider abstraction.
 *
 * Implementations calculate driving distances between waypoints.
 * The interface is intentionally minimal — providers may cache, batch, or
 * approximate, but must always return a distance or throw a RoutingError.
 */

export interface RouteWaypoint {
  latitude: number;
  longitude: number;
  label?: string;
}

export interface RouteLegResult {
  distanceM: number;
  durationS: number;
}

export interface RouteResult {
  totalDistanceM: number;
  totalDurationS: number;
  legs: RouteLegResult[];
  provider: string;
  calculatedAt: string;
  providerMeta?: unknown;
}

/**
 * Typed error for routing failures. Carries a machine-readable `code` so that
 * the API layer can map to appropriate HTTP statuses.
 */
export class RoutingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RoutingError";
    this.code = code;
  }

  static invalidWaypoints(message = "At least 2 waypoints are required"): RoutingError {
    return new RoutingError("INVALID_WAYPOINTS", message);
  }

  static noRoute(message = "No route found between the given waypoints"): RoutingError {
    return new RoutingError("NO_ROUTE", message);
  }

  static providerError(message = "Routing provider returned an error"): RoutingError {
    return new RoutingError("PROVIDER_ERROR", message);
  }

  static timeout(): RoutingError {
    return new RoutingError("TIMEOUT", "Routing request timed out");
  }

  static rateLimited(): RoutingError {
    return new RoutingError("RATE_LIMITED", "Routing provider rate limit exceeded");
  }

  static notConfigured(): RoutingError {
    return new RoutingError(
      "NOT_CONFIGURED",
      "No routing provider is configured. Set MAPBOX_ACCESS_TOKEN to enable route calculations.",
    );
  }
}

export interface RoutingProvider {
  readonly name: string;
  calculateRoute(waypoints: RouteWaypoint[]): Promise<RouteResult>;
}
