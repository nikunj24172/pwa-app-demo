"use client";

/**
 * Best-effort location for the audit trail. Resolves a human-readable place
 * ("Navrangpura, Ahmedabad, Gujarat") via OpenStreetMap reverse geocoding,
 * falling back to raw "lat, lng" when the lookup fails (e.g. offline).
 * Never rejects, never blocks the flow it's called from. Users who deny the
 * permission simply produce audit entries without a location.
 */
export async function getLocation(timeoutMs = 5000): Promise<string | undefined> {
  const coords = await getCoords(timeoutMs);
  if (!coords) return undefined;
  const place = await reverseGeocode(coords.lat, coords.lng);
  return place ?? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
}

function getCoords(timeoutMs: number): Promise<{ lat: number; lng: number } | undefined> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return resolve(undefined);
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(undefined),
      { timeout: timeoutMs, maximumAge: 60_000 }
    );
  });
}

// Cache lookups by ~100m grid so repeated searches from one spot make a single
// geocoding request (also keeps us well inside Nominatim's usage policy).
const geocodeCache = new Map<string, string | undefined>();

async function reverseGeocode(lat: number, lng: number): Promise<string | undefined> {
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&accept-language=en`,
      { signal: AbortSignal.timeout(4000), headers: { Accept: "application/json" } }
    );
    if (!res.ok) return undefined;
    const j = (await res.json()) as {
      display_name?: string;
      address?: Record<string, string>;
    };
    const a = j.address ?? {};
    const parts = [
      a.suburb || a.neighbourhood || a.quarter || a.village || a.town,
      a.city || a.town || a.municipality || a.county,
      a.state,
    ].filter(Boolean);
    const place = parts.length
      ? [...new Set(parts)].join(", ")
      : j.display_name?.split(",").slice(0, 3).join(",").trim() || undefined;
    geocodeCache.set(cacheKey, place);
    return place;
  } catch {
    return undefined; // offline / rate-limited → caller falls back to coords
  }
}
