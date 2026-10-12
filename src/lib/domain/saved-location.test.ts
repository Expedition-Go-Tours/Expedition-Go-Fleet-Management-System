import { describe, expect, it } from "vitest";

import {
  SAVED_LOCATION_CATEGORIES,
  savedLocationToStop,
  validateSavedLocation,
} from "@/lib/domain/saved-location";

describe("saved-location validation", () => {
  it("accepts a valid location with coordinates", () => {
    const result = validateSavedLocation({
      label: "Accra Office",
      category: "OFFICE",
      latitude: 5.556,
      longitude: -0.1969,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a location without coordinates", () => {
    const result = validateSavedLocation({
      label: "Accra Office",
      category: "OFFICE",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an empty label", () => {
    const result = validateSavedLocation({ label: "  ", category: "OFFICE" });
    expect(result.ok).toBe(false);
  });

  it("rejects a label that is too long", () => {
    const result = validateSavedLocation({
      label: "x".repeat(201),
      category: "OFFICE",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid category", () => {
    const result = validateSavedLocation({
      label: "Test",
      category: "INVALID" as never,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects latitude without longitude", () => {
    const result = validateSavedLocation({
      label: "Test",
      category: "OFFICE",
      latitude: 5.0,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects out-of-range latitude", () => {
    const result = validateSavedLocation({
      label: "Test",
      category: "OFFICE",
      latitude: 100,
      longitude: -0.1,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects out-of-range longitude", () => {
    const result = validateSavedLocation({
      label: "Test",
      category: "OFFICE",
      latitude: 5.0,
      longitude: 200,
    });
    expect(result.ok).toBe(false);
  });
});

describe("savedLocationToStop", () => {
  it("converts a saved location to a trip stop", () => {
    const stop = savedLocationToStop(
      {
        id: "loc1",
        label: "Accra Airport",
        category: "AIRPORT",
        address: "Airport Rd, Accra",
        latitude: 5.6052,
        longitude: -0.1668,
        placeId: "osm:12345",
        notes: null,
        active: true,
        createdBy: "u1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      0,
      "ORIGIN",
    );

    expect(stop.label).toBe("Accra Airport");
    expect(stop.latitude).toBe(5.6052);
    expect(stop.longitude).toBe(-0.1668);
    expect(stop.sequence).toBe(0);
    expect(stop.type).toBe("ORIGIN");
    expect(stop.id).toMatch(/^stop_/);
  });
});

describe("SAVED_LOCATION_CATEGORIES", () => {
  it("includes the expected categories", () => {
    expect(SAVED_LOCATION_CATEGORIES).toContain("OFFICE");
    expect(SAVED_LOCATION_CATEGORIES).toContain("AIRPORT");
    expect(SAVED_LOCATION_CATEGORIES).toContain("HOTEL");
    expect(SAVED_LOCATION_CATEGORIES).toContain("TOUR_ATTRACTION");
    expect(SAVED_LOCATION_CATEGORIES).toContain("WORKSHOP");
    expect(SAVED_LOCATION_CATEGORIES).toContain("FUEL_STATION");
  });
});
