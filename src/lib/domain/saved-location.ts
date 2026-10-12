/*
 * Saved company locations (named places frequently used as trip stops).
 *
 * Pure domain types and validation — no I/O.
 */

export const SAVED_LOCATION_CATEGORIES = [
  "OFFICE",
  "AIRPORT",
  "HOTEL",
  "TOUR_ATTRACTION",
  "WORKSHOP",
  "FUEL_STATION",
  "PICKUP_POINT",
  "DROPOFF_POINT",
  "OTHER",
] as const;
export type SavedLocationCategory = (typeof SAVED_LOCATION_CATEGORIES)[number];

export interface SavedLocation {
  id: string;
  label: string;
  category: SavedLocationCategory;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  notes: string | null;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type SavedLocationValidation = { ok: true } | { ok: false; error: string };

export function validateSavedLocation(
  input: Partial<SavedLocation>,
): SavedLocationValidation {
  if (!input.label || input.label.trim().length === 0) {
    return { ok: false, error: "Label is required" };
  }
  if (input.label.length > 200) {
    return { ok: false, error: "Label must be 200 characters or fewer" };
  }
  if (
    !input.category ||
    !(SAVED_LOCATION_CATEGORIES as readonly string[]).includes(input.category)
  ) {
    return {
      ok: false,
      error: `Category must be one of: ${SAVED_LOCATION_CATEGORIES.join(", ")}`,
    };
  }
  // Coordinates must be both present or both absent
  const hasLat = input.latitude !== null && input.latitude !== undefined;
  const hasLng = input.longitude !== null && input.longitude !== undefined;
  if (hasLat !== hasLng) {
    return { ok: false, error: "Latitude and longitude must both be provided or both be omitted" };
  }
  if (hasLat) {
    if (
      typeof input.latitude !== "number" ||
      input.latitude < -90 ||
      input.latitude > 90
    ) {
      return { ok: false, error: "Latitude must be between -90 and 90" };
    }
    if (
      typeof input.longitude !== "number" ||
      input.longitude < -180 ||
      input.longitude > 180
    ) {
      return { ok: false, error: "Longitude must be between -180 and 180" };
    }
  }
  return { ok: true };
}

/**
 * Convert a saved location into a TripStop (with a fresh ID and sequence).
 */
export function savedLocationToStop(
  location: SavedLocation,
  sequence: number,
  type: "ORIGIN" | "INTERMEDIATE" | "DESTINATION",
) {
  return {
    id: `stop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    sequence,
    type,
    label: location.label,
    address: location.address ?? null,
    latitude: location.latitude ?? null,
    longitude: location.longitude ?? null,
    placeId: location.placeId ?? null,
    purpose: null,
    notes: null,
    arrivedAt: null,
    departedAt: null,
  };
}
