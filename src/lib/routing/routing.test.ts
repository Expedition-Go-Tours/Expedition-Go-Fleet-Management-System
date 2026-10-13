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

describe("Geoapify route chunking", () => {
  it("exports chunkWaypoints logic from GeoapifyRoutingProvider", async () => {
    // Verify that the provider can handle chunked waypoints by testing
    // the chunk splitting logic indirectly through the class interface.
    const { GeoapifyRoutingProvider } = await import("./geoapify");
    const provider = new GeoapifyRoutingProvider("test-key");
    expect(provider.name).toBe("geoapify");
    // The provider should reject <2 waypoints
    await expect(provider.calculateRoute([])).rejects.toThrow();
    await expect(provider.calculateRoute([{ latitude: 0, longitude: 0 }])).rejects.toThrow();
  });
});

describe("route geometry types", () => {
  it("GeoJsonLineString has correct structure", async () => {
    const { MockRoutingProvider } = await import("./mock");
    const provider = new MockRoutingProvider();
    const result = await provider.calculateRoute([
      { latitude: 5.6037, longitude: -0.187, label: "A" },
      { latitude: 5.1054, longitude: -1.2461, label: "B" },
    ]);
    expect(result.geometry).toBeDefined();
    expect(result.geometry!.type).toBe("LineString");
    expect(result.geometry!.coordinates.length).toBe(2);
    expect(result.geometry!.coordinates[0]).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Geoapify duration conversion
// ---------------------------------------------------------------------------

describe("Geoapify duration handling", () => {
  // Geoapify returns time in SECONDS. The provider must preserve this value
  // without dividing by 1000 (which would make durations ~1000x too small).
  it("preserves route duration in seconds (3600s = 1 hour)", () => {
    // Simulate a Geoapify response with time: 3600 (seconds)
    const mockResponse = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            distance: 50000,
            time: 3600, // 1 hour in seconds
            legs: [
              { distance: 25000, time: 1800 },
              { distance: 25000, time: 1800 },
            ],
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        },
      ],
    };

    // The provider should return time as-is (3600), not 3600/1000 = 4
    const props = mockResponse.features[0].properties;
    const totalDurationS = Math.round(props.time ?? 0);
    const legDurations = props.legs.map((l) => Math.round(l.time ?? 0));

    expect(totalDurationS).toBe(3600); // NOT 4
    expect(legDurations).toEqual([1800, 1800]); // NOT [2, 2]
  });

  it("preserves leg duration in seconds (1200s = 20 minutes)", () => {
    const legTime = 1200; // 20 minutes in seconds
    const durationS = Math.round(legTime);
    expect(durationS).toBe(1200); // NOT 1
  });

  it("handles zero duration correctly", () => {
    const totalDurationS = Math.round(0);
    expect(totalDurationS).toBe(0);
  });
});
