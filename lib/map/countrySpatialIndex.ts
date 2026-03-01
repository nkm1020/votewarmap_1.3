import type { FeatureCollection, Geometry, Position } from 'geojson';
import type { SupportedCountry } from '@/lib/map/countryMapRegistry';

type Ring = Position[];
type PolygonRings = Ring[];

export type CountrySpatialEntry = {
  country: SupportedCountry;
  bbox: [number, number, number, number];
  polygons: PolygonRings[];
};

export type CountrySpatialIndex = CountrySpatialEntry[];

function toSupportedCountry(value: unknown): SupportedCountry | null {
  const code = String(value ?? '').trim().toUpperCase();
  if (
    code === 'KR' ||
    code === 'US' ||
    code === 'JP' ||
    code === 'CN' ||
    code === 'UK' ||
    code === 'IE' ||
    code === 'DE' ||
    code === 'FR' ||
    code === 'IT'
  ) {
    return code;
  }
  return null;
}

function extractPolygons(geometry: Geometry | null | undefined): PolygonRings[] {
  if (!geometry) {
    return [];
  }
  if (geometry.type === 'Polygon') {
    return [geometry.coordinates as PolygonRings];
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates as PolygonRings[];
  }
  return [];
}

function ringContainsPoint(ring: Ring, lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = Number(ring[i]?.[0]);
    const yi = Number(ring[i]?.[1]);
    const xj = Number(ring[j]?.[0]);
    const yj = Number(ring[j]?.[1]);
    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonContainsPoint(polygon: PolygonRings, lng: number, lat: number): boolean {
  if (polygon.length === 0) {
    return false;
  }
  if (!ringContainsPoint(polygon[0], lng, lat)) {
    return false;
  }
  for (let index = 1; index < polygon.length; index += 1) {
    if (ringContainsPoint(polygon[index], lng, lat)) {
      return false;
    }
  }
  return true;
}

export function buildCountrySpatialIndex(
  featureCollection: FeatureCollection,
): CountrySpatialIndex {
  const entries: CountrySpatialIndex = [];

  for (const feature of featureCollection.features ?? []) {
    const country = toSupportedCountry((feature.properties as Record<string, unknown> | undefined)?.code);
    if (!country) {
      continue;
    }

    const polygons = extractPolygons(feature.geometry);
    if (polygons.length === 0) {
      continue;
    }

    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;

    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (const point of ring) {
          const lng = Number(point?.[0]);
          const lat = Number(point?.[1]);
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            continue;
          }
          minLng = Math.min(minLng, lng);
          minLat = Math.min(minLat, lat);
          maxLng = Math.max(maxLng, lng);
          maxLat = Math.max(maxLat, lat);
        }
      }
    }

    if (!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) {
      continue;
    }

    entries.push({
      country,
      bbox: [minLng, minLat, maxLng, maxLat],
      polygons,
    });
  }

  return entries.sort((a, b) => {
    const areaA = Math.abs((a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]));
    const areaB = Math.abs((b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]));
    return areaA - areaB;
  });
}

export function detectActiveCountryByCenter(
  spatialIndex: CountrySpatialIndex,
  center: [number, number],
  fallbackCountry: SupportedCountry | null = null,
): SupportedCountry | null {
  const [lng, lat] = center;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return fallbackCountry;
  }

  for (const entry of spatialIndex) {
    const [minLng, minLat, maxLng, maxLat] = entry.bbox;
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) {
      continue;
    }

    const contained = entry.polygons.some((polygon) => polygonContainsPoint(polygon, lng, lat));
    if (contained) {
      return entry.country;
    }
  }

  return fallbackCountry;
}
