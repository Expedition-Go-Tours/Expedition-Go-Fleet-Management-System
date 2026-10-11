import { describe, expect, it } from "vitest";

import { MockRoutingProvider, haversineDistanceM } from "@/lib/routing/mock";
import { RoutingError } from "@/lib/routing/provider";

// ---------------------------------------------------------------------------
// Haversine distance
// ---------------------------------------------------------------------------

describe("haversineDistanceM", () => {
  it("returns 0 for the same point", () => {
    expect(haversineDistanceM(5.6037, -0.187, 5.6037, -0.187)).toBe(0);
  });

  it("calculates distance between Accra and Cape Coast (~150km straight-line)", () => {
    // Accra: 5.6037, -0.1870; Cape Coast: 5.1054, -1.2461
    const d = haversineDistanceM(5.6037, -0.187, 5.1054, -1.2461);
    // Straight line ~130km, so expect between 100km and 200km
    expect(d).toBeGreaterThan(100_000);
    expect(d).toBeLessThan(200_000);
  });

  it("calculates distance between Kotoka Airport and Accra city centre", () => {
    // Kotoka (5.6052, -0.1668) to central Accra (5.6037, -0.187) is ~2km straight-line
    const d = haversineDistanceM(5.6052, -0.1668, 5.6037, -0.187);
    expect(d).toBeGreaterThan(1_000);
    expect(d).toBeLessThan(10_000);
  });
});

// ---------------------------------------------------------------------------
// Mock routing provider
// ---------------------------------------------------------------------------

describe("MockRoutingProvider", () => {
  const provider = new MockRoutingProvider();

  it("has name 'mock'", () => {
    expect(provider.name).toBe("mock");
  });

  it("calculates a simple two-waypoint route", async () => {
    const result = await provider.calculateRoute([
      { latitude: 5.6037, longitude: -0.187, label: "Accra Office" },
      { latitude: 5.6052, longitude: -0.1668, label: "Kotoka Airport" },
    ]);

    expect(result.totalDistanceM).toBeGreaterThan(0);
    expect(result.totalDurationS).toBeGreaterThan(0);
    expect(result.legs).toHaveLength(1);
    expect(result.legs[0].distanceM).toBe(result.totalDistanceM);
    expect(result.provider).toBe("mock");
    expect(result.calculatedAt).toBeTruthy();
  });

  it("calculates a multi-stop route with correct leg breakdown", async () => {
    const result = await provider.calculateRoute([
      { latitude: 5.6037, longitude: -0.187, label: "Accra" },
      { latitude: 5.6052, longitude: -0.1668, label: "Airport" },
      { latitude: 5.1054, longitude: -1.2461, label: "Cape Coast" },
    ]);

    expect(result.legs).toHaveLength(2);
    expect(result.totalDistanceM).toBe(result.legs[0].distanceM + result.legs[1].distanceM);
    expect(result.totalDurationS).toBeGreaterThan(0);
  });

  it("calculates a return journey", async () => {
    const result = await provider.calculateRoute([
      { latitude: 5.6037, longitude: -0.187, label: "Accra" },
      { latitude: 5.1054, longitude: -1.2461, label: "Cape Coast" },
      { latitude: 5.6037, longitude: -0.187, label: "Accra" },
    ]);

    // 3 waypoints → 2 legs (A→B, B→A)
    expect(result.legs).toHaveLength(2);
    // Return leg should be similar to outbound (± a few metres)
    const outbound = result.legs[0].distanceM;
    const inbound = result.legs[1].distanceM;
    expect(Math.abs(outbound - inbound)).toBeLessThan(100);
  });

  it("throws INVALID_WAYPOINTS for fewer than 2 waypoints", async () => {
    await expect(provider.calculateRoute([])).rejects.toThrow(RoutingError);
    await expect(
      provider.calculateRoute([{ latitude: 5.6037, longitude: -0.187 }]),
    ).rejects.toThrow(RoutingError);
  });

  it("uses the road factor (distance > straight-line)", async () => {
    const straight = haversineDistanceM(5.6037, -0.187, 5.1054, -1.2461);
    const result = await provider.calculateRoute([
      { latitude: 5.6037, longitude: -0.187, label: "Accra" },
      { latitude: 5.1054, longitude: -1.2461, label: "Cape Coast" },
    ]);
    // Road distance should be 1.3x straight-line (our ROAD_FACTOR)
    expect(result.totalDistanceM).toBeGreaterThan(straight * 1.2);
    expect(result.totalDistanceM).toBeLessThan(straight * 1.5);
  });

  it("handles duplicate consecutive locations with near-zero distance", async () => {
    const result = await provider.calculateRoute([
      { latitude: 5.6037, longitude: -0.187, label: "Office" },
      { latitude: 5.6037, longitude: -0.187, label: "Office" },
    ]);
    expect(result.totalDistanceM).toBeLessThan(100);
    expect(result.legs).toHaveLength(1);
  });

  it("returns consistent results for the same waypoints", async () => {
    const waypoints = [
      { latitude: 5.6037, longitude: -0.187, label: "A" },
      { latitude: 5.6052, longitude: -0.1668, label: "B" },
    ];
    const r1 = await provider.calculateRoute(waypoints);
    const r2 = await provider.calculateRoute(waypoints);
    expect(r1.totalDistanceM).toBe(r2.totalDistanceM);
    expect(r1.totalDurationS).toBe(r2.totalDurationS);
  });
});

// ---------------------------------------------------------------------------
// RoutingError
// ---------------------------------------------------------------------------

describe("RoutingError", () => {
  it("has the correct code for each factory", () => {
    expect(RoutingError.invalidWaypoints().code).toBe("INVALID_WAYPOINTS");
    expect(RoutingError.noRoute().code).toBe("NO_ROUTE");
    expect(RoutingError.providerError().code).toBe("PROVIDER_ERROR");
    expect(RoutingError.timeout().code).toBe("TIMEOUT");
    expect(RoutingError.rateLimited().code).toBe("RATE_LIMITED");
    expect(RoutingError.notConfigured().code).toBe("NOT_CONFIGURED");
  });

  it("carries a human-readable message", () => {
    const err = RoutingError.noRoute("Custom message");
    expect(err.message).toBe("Custom message");
  });
});
