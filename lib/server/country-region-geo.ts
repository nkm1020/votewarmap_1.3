import fs from 'node:fs';
import path from 'node:path';
import type { Geometry, Position } from 'geojson';
import {
  getCountryMapConfig,
  resolveSupportedCountry,
  type SupportedCountry,
} from '@/lib/map/countryMapRegistry';

type GeoFeature = {
  properties?: Record<string, unknown>;
  geometry?: Geometry | null;
};

type GeoCollection = {
  features?: GeoFeature[];
};

type Ring = Position[];
type PolygonRings = Ring[];

type RegionFeature = {
  code: string;
  name: string | null;
  parentCandidates: string[];
  polygons: PolygonRings[];
  bbox: [number, number, number, number];
  centroid: {
    lat: number;
    lng: number;
  } | null;
};

type LevelIndex = {
  features: RegionFeature[];
  byCode: Map<string, RegionFeature>;
};

const levelIndexCache = new Map<string, LevelIndex>();

function normalizeCode(value: unknown): string {
  return String(value ?? '').trim();
}

function parsePublicDataPath(sourceUrl: string): string {
  const [pathname] = sourceUrl.split('?');
  const normalized = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  return path.join(process.cwd(), 'public', normalized);
}

function toParentCandidates(properties: Record<string, unknown> | undefined): string[] {
  if (!properties) {
    return [];
  }

  const keys = [
    'state_code',
    'province_code',
    'region_code',
    'parent_code',
    'l1_code',
    'country_code',
    'sido_code',
  ];
  const values = new Set<string>();
  keys.forEach((key) => {
    const value = normalizeCode(properties[key]);
    if (value) {
      values.add(value);
    }
  });
  return Array.from(values);
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

    if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) {
      continue;
    }

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

function computeBoundsAndCentroid(polygons: PolygonRings[]): {
  bbox: [number, number, number, number];
  centroid: { lat: number; lng: number } | null;
} | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  polygons.forEach((polygon) => {
    polygon.forEach((ring) => {
      ring.forEach((point) => {
        const lng = Number(point?.[0]);
        const lat = Number(point?.[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
          return;
        }
        minLng = Math.min(minLng, lng);
        minLat = Math.min(minLat, lat);
        maxLng = Math.max(maxLng, lng);
        maxLat = Math.max(maxLat, lat);
      });
    });
  });

  if (!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) {
    return null;
  }

  return {
    bbox: [minLng, minLat, maxLng, maxLat],
    centroid: {
      lng: (minLng + maxLng) / 2,
      lat: (minLat + maxLat) / 2,
    },
  };
}

function compareFeatureArea(a: RegionFeature, b: RegionFeature): number {
  const areaA = Math.abs((a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]));
  const areaB = Math.abs((b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]));
  return areaA - areaB;
}

function loadLevelIndex(country: SupportedCountry, level: 'l1' | 'l2'): LevelIndex {
  const cacheKey = `${country}:${level}`;
  const cached = levelIndexCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const config = getCountryMapConfig(country);
  const levelConfig = config.levels[level];
  if (!levelConfig) {
    const emptyIndex: LevelIndex = { features: [], byCode: new Map() };
    levelIndexCache.set(cacheKey, emptyIndex);
    return emptyIndex;
  }

  const filePath = parsePublicDataPath(levelConfig.sourceUrl);
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as GeoCollection;

  const features: RegionFeature[] = [];
  const byCode = new Map<string, RegionFeature>();

  (parsed.features ?? []).forEach((feature) => {
    const code = normalizeCode(feature.properties?.code);
    if (!code) {
      return;
    }

    const polygons = extractPolygons(feature.geometry);
    if (polygons.length === 0) {
      return;
    }

    const bounds = computeBoundsAndCentroid(polygons);
    if (!bounds) {
      return;
    }

    const entry: RegionFeature = {
      code,
      name: normalizeCode(feature.properties?.name) || null,
      parentCandidates: toParentCandidates(feature.properties),
      polygons,
      bbox: bounds.bbox,
      centroid: bounds.centroid,
    };

    features.push(entry);
    byCode.set(code, entry);
  });

  features.sort(compareFeatureArea);

  const built: LevelIndex = { features, byCode };
  levelIndexCache.set(cacheKey, built);
  return built;
}

function findContainingFeature(index: LevelIndex, lng: number, lat: number): RegionFeature | null {
  for (const feature of index.features) {
    const [minLng, minLat, maxLng, maxLat] = feature.bbox;
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) {
      continue;
    }
    const inside = feature.polygons.some((polygon) => polygonContainsPoint(polygon, lng, lat));
    if (inside) {
      return feature;
    }
  }
  return null;
}

function resolveParentL1FromL2(country: SupportedCountry, l2Feature: RegionFeature): RegionFeature | null {
  const l1Index = loadLevelIndex(country, 'l1');
  for (const candidate of l2Feature.parentCandidates) {
    const matched = l1Index.byCode.get(candidate);
    if (matched) {
      return matched;
    }
  }
  return null;
}

export function resolveCountryRegionFromPoint(args: {
  countryCode: string;
  latitude: number;
  longitude: number;
}): {
  sidoCode: string;
  sigunguCode: string | null;
  sidoName: string | null;
  sigunguName: string | null;
  provider: 'geojson';
} | null {
  const country = resolveSupportedCountry(args.countryCode);
  const lng = Number(args.longitude);
  const lat = Number(args.latitude);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null;
  }

  const l1Index = loadLevelIndex(country, 'l1');
  const l2Index = loadLevelIndex(country, 'l2');
  const l2Match = findContainingFeature(l2Index, lng, lat);
  const l1Match = findContainingFeature(l1Index, lng, lat) ?? (l2Match ? resolveParentL1FromL2(country, l2Match) : null);

  if (!l1Match && !l2Match) {
    return null;
  }

  const sidoCode = l1Match?.code ?? l2Match?.code ?? '';
  if (!sidoCode) {
    return null;
  }

  const sigunguCode = l2Match ? (l2Match.code === sidoCode ? null : l2Match.code) : null;

  return {
    sidoCode,
    sigunguCode,
    sidoName: l1Match?.name ?? null,
    sigunguName: l2Match?.name ?? null,
    provider: 'geojson',
  };
}

export function getCountryRegionNameByCodes(args: {
  countryCode: string;
  sidoCode?: string | null;
  sigunguCode?: string | null;
}): string | null {
  const country = resolveSupportedCountry(args.countryCode);
  const sigunguCode = normalizeCode(args.sigunguCode);
  if (sigunguCode) {
    const l2Match = loadLevelIndex(country, 'l2').byCode.get(sigunguCode);
    if (l2Match?.name) {
      return l2Match.name;
    }
  }

  const sidoCode = normalizeCode(args.sidoCode);
  if (!sidoCode) {
    return null;
  }
  const l1Match = loadLevelIndex(country, 'l1').byCode.get(sidoCode);
  return l1Match?.name ?? null;
}

export function getCountryRegionCentroid(args: {
  countryCode: string;
  level: 'sido' | 'sigungu';
  regionCode: string;
}): { lat: number; lng: number } | null {
  const country = resolveSupportedCountry(args.countryCode);
  const level = args.level === 'sigungu' ? 'l2' : 'l1';
  const code = normalizeCode(args.regionCode);
  if (!code) {
    return null;
  }
  const feature = loadLevelIndex(country, level).byCode.get(code);
  return feature?.centroid ?? null;
}
