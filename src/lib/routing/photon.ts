/**
 * Photon geocoding for location search.
 *
 * Photon is a free, open-source geocoding service based on OpenStreetMap data.
 * API: https://photon.komoot.io/
 *
 * This is a server-side geocoding service — coordinates are resolved server-side
 * and never expose API keys to the browser.
 */

export interface GeocodingResult {
  label: string;
  latitude: number;
  longitude: number;
  country?: string;
  city?: string;
  postcode?: string;
  type?: string;
  placeId?: string;
}

const PHOTON_BASE = "https://photon.komoot.io/api";
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Search for places using Photon geocoding.
 * @param query The search text (address, place name, etc.)
 * @param biasLat Optional latitude for proximity bias
 * @param biasLng Optional longitude for proximity bias
 * @param limit Maximum results (default 8)
 */
export async function searchPlaces(
  query: string,
  biasLat?: number,
  biasLng?: number,
  limit = 8,
): Promise<GeocodingResult[]> {
  if (!query || query.trim().length < 2) return [];

  const url = new URL(PHOTON_BASE);
  url.searchParams.set("q", query.trim());
  url.searchParams.set("limit", String(limit));
  // Bias toward Ghana when coordinates provided
  if (biasLat != null && biasLng != null) {
    url.searchParams.set("lon", String(biasLng));
    url.searchParams.set("lat", String(biasLat));
  }
  // Bias toward Ghana by default
  url.searchParams.set("lang", "en");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[photon] HTTP ${response.status}`);
      return [];
    }

    const body = (await response.json()) as {
      features?: Array<{
        properties: {
          name?: string;
          country?: string;
          city?: string;
          postcode?: string;
          type?: string;
          osm_id?: string;
          housenumber?: string;
          street?: string;
        };
        geometry: { coordinates: [number, number] };
      }>;
    };

    return (body.features ?? []).map((f) => {
      const p = f.properties;
      const parts = [
        p.name || [p.housenumber, p.street].filter(Boolean).join(" "),
        p.city,
        p.country,
      ].filter(Boolean);
      return {
        label: parts.join(", "),
        latitude: f.geometry.coordinates[1],
        longitude: f.geometry.coordinates[0],
        country: p.country,
        city: p.city,
        postcode: p.postcode,
        type: p.type,
        placeId: p.osm_id ? `osm:${p.osm_id}` : undefined,
      };
    });
  } catch {
    clearTimeout(timeout);
    return [];
  }
}
