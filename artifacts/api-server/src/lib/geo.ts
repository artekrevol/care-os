export type LatLng = { lat: number; lng: number };

const CITY_LATLNG: Record<string, LatLng> = {
  "san francisco": { lat: 37.7749, lng: -122.4194 },
  "daly city": { lat: 37.6879, lng: -122.4702 },
  "oakland": { lat: 37.8044, lng: -122.2711 },
  "hayward": { lat: 37.6688, lng: -122.0808 },
  "san jose": { lat: 37.3382, lng: -121.8863 },
  "concord": { lat: 37.978, lng: -122.0311 },
  "redwood city": { lat: 37.4852, lng: -122.2364 },
  "fremont": { lat: 37.5485, lng: -121.9886 },
  "san mateo": { lat: 37.5630, lng: -122.3255 },
  "berkeley": { lat: 37.8716, lng: -122.273 },
  "walnut creek": { lat: 37.9101, lng: -122.0652 },
  "alameda": { lat: 37.7652, lng: -122.2416 },
  "palo alto": { lat: 37.4419, lng: -122.143 },
  "burlingame": { lat: 37.5779, lng: -122.348 },
  "mountain view": { lat: 37.3861, lng: -122.0839 },
  "belmont": { lat: 37.5202, lng: -122.2758 },
  "sebastopol": { lat: 38.4021, lng: -122.8239 },
  "milpitas": { lat: 37.4323, lng: -121.8996 },
  "santa clara": { lat: 37.3541, lng: -121.9552 },
  "sunnyvale": { lat: 37.3688, lng: -122.0363 },
};

export function geocodeCity(
  city: string | null | undefined,
): LatLng | null {
  if (!city) return null;
  return CITY_LATLNG[city.trim().toLowerCase()] ?? null;
}

export function pickHomeLatLng(opts: {
  homeLat?: string | number | null;
  homeLng?: string | number | null;
  city?: string | null;
}): LatLng | null {
  if (opts.homeLat != null && opts.homeLng != null) {
    const lat = Number(opts.homeLat);
    const lng = Number(opts.homeLng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return geocodeCity(opts.city);
}
