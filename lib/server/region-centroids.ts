import fs from 'node:fs';
import path from 'node:path';

export type RegionLevel = 'sido' | 'sigungu';

export type RegionCentroid = {
  lat: number;
  lng: number;
};

type GeoJsonFeature = {
  properties?: {
    code?: unknown;
  };
  geometry?: {
    coordinates?: unknown;
  };
};

type GeoJsonCollection = {
  features?: GeoJsonFeature[];
};

type Bounds = {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
};

const GEOJSON_BY_LEVEL: Record<RegionLevel, string> = {
  sido: 'skorea_provinces_geo_simple.json',
  sigungu: 'skorea_municipalities_geo_simple.json',
};

const centroidCache = new Map<RegionLevel, Map<string, RegionCentroid>>();

function normalizeCode(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function createInitialBounds(): Bounds {
  return {
    minLng: Number.POSITIVE_INFINITY,
    maxLng: Number.NEGATIVE_INFINITY,
    minLat: Number.POSITIVE_INFINITY,
    maxLat: Number.NEGATIVE_INFINITY,
  };
}

function updateBounds(bounds: Bounds, coordinates: unknown): void {
  if (!Array.isArray(coordinates)) {
    return;
  }

  if (
    coordinates.length >= 2 &&
    typeof coordinates[0] === 'number' &&
    Number.isFinite(coordinates[0]) &&
    typeof coordinates[1] === 'number' &&
    Number.isFinite(coordinates[1])
  ) {
    const lng = coordinates[0];
    const lat = coordinates[1];
    bounds.minLng = Math.min(bounds.minLng, lng);
    bounds.maxLng = Math.max(bounds.maxLng, lng);
    bounds.minLat = Math.min(bounds.minLat, lat);
    bounds.maxLat = Math.max(bounds.maxLat, lat);
    return;
  }

  coordinates.forEach((entry) => updateBounds(bounds, entry));
}

function buildLevelCentroidMap(level: RegionLevel): Map<string, RegionCentroid> {
  const cached = centroidCache.get(level);
  if (cached) {
    return cached;
  }

  const fileName = GEOJSON_BY_LEVEL[level];
  const filePath = path.join(process.cwd(), 'public', 'data', fileName);
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as GeoJsonCollection;

  const nextMap = new Map<string, RegionCentroid>();

  (parsed.features ?? []).forEach((feature) => {
    const regionCode = normalizeCode(feature.properties?.code);
    if (!regionCode) {
      return;
    }

    const bounds = createInitialBounds();
    updateBounds(bounds, feature.geometry?.coordinates);

    if (
      !Number.isFinite(bounds.minLng) ||
      !Number.isFinite(bounds.maxLng) ||
      !Number.isFinite(bounds.minLat) ||
      !Number.isFinite(bounds.maxLat)
    ) {
      return;
    }

    nextMap.set(regionCode, {
      lng: (bounds.minLng + bounds.maxLng) / 2,
      lat: (bounds.minLat + bounds.maxLat) / 2,
    });
  });

  centroidCache.set(level, nextMap);
  return nextMap;
}

export function getRegionCentroid(level: RegionLevel, regionCode: string): RegionCentroid | null {
  const normalizedCode = normalizeCode(regionCode);
  if (!normalizedCode) {
    return null;
  }

  const centroidMap = buildLevelCentroidMap(level);
  return centroidMap.get(normalizedCode) ?? null;
}
