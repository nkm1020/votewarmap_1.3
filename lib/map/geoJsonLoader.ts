import {
  getCountryMapConfig,
  getWorldSupportedCountriesGeoUrl,
  type CountryMapLevel,
  type SupportedCountry,
} from '@/lib/map/countryMapRegistry';

type GeoJsonFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type?: string;
    id?: string | number;
    properties?: Record<string, unknown>;
    geometry?: unknown;
  }>;
};

const dataCache = new Map<string, GeoJsonFeatureCollection>();
const inFlightCache = new Map<string, Promise<GeoJsonFeatureCollection>>();
const worldDataCache = new Map<string, GeoJsonFeatureCollection>();
const worldInFlightCache = new Map<string, Promise<GeoJsonFeatureCollection>>();

function toCacheKey(country: SupportedCountry, level: CountryMapLevel): string {
  return `${country}:${level}`;
}

function normalizeGeoJson(input: unknown): GeoJsonFeatureCollection {
  const candidate = (input ?? {}) as GeoJsonFeatureCollection;
  if (candidate.type === 'FeatureCollection' && Array.isArray(candidate.features)) {
    return candidate;
  }
  return { type: 'FeatureCollection', features: [] };
}

function mergeAbortSignals(signalA?: AbortSignal, signalB?: AbortSignal): AbortSignal | undefined {
  if (!signalA) {
    return signalB;
  }
  if (!signalB) {
    return signalA;
  }

  const controller = new AbortController();
  const abort = () => controller.abort();

  if (signalA.aborted || signalB.aborted) {
    controller.abort();
  } else {
    signalA.addEventListener('abort', abort, { once: true });
    signalB.addEventListener('abort', abort, { once: true });
  }

  return controller.signal;
}

export async function loadGeoJsonForLevel(
  country: SupportedCountry,
  level: CountryMapLevel,
  signal?: AbortSignal,
): Promise<GeoJsonFeatureCollection> {
  const config = getCountryMapConfig(country);
  const levelConfig = config.levels[level];
  if (!levelConfig) {
    return { type: 'FeatureCollection', features: [] };
  }

  const key = toCacheKey(country, level);
  const cached = dataCache.get(key);
  if (cached) {
    return cached;
  }

  const inFlight = inFlightCache.get(key);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    const controller = new AbortController();
    const requestSignal = mergeAbortSignals(signal, controller.signal);
    const response = await fetch(levelConfig.sourceUrl, {
      cache: 'force-cache',
      signal: requestSignal,
    });

    if (!response.ok) {
      throw new Error(`Failed to load geojson ${country}:${level} (${response.status})`);
    }

    const json = normalizeGeoJson(await response.json());
    dataCache.set(key, json);
    return json;
  })()
    .finally(() => {
      inFlightCache.delete(key);
    });

  inFlightCache.set(key, request);
  return request;
}

export function clearGeoJsonCache(): void {
  dataCache.clear();
  inFlightCache.clear();
  worldDataCache.clear();
  worldInFlightCache.clear();
}

export function getCachedGeoJson(
  country: SupportedCountry,
  level: CountryMapLevel,
): GeoJsonFeatureCollection | null {
  return dataCache.get(toCacheKey(country, level)) ?? null;
}

export async function loadWorldSupportedCountriesGeo(
  signal?: AbortSignal,
): Promise<GeoJsonFeatureCollection> {
  const sourceUrl = getWorldSupportedCountriesGeoUrl();
  const cached = worldDataCache.get(sourceUrl);
  if (cached) {
    return cached;
  }

  const inFlight = worldInFlightCache.get(sourceUrl);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    const controller = new AbortController();
    const requestSignal = mergeAbortSignals(signal, controller.signal);
    const response = await fetch(sourceUrl, {
      cache: 'force-cache',
      signal: requestSignal,
    });

    if (!response.ok) {
      throw new Error(`Failed to load world supported countries geo (${response.status})`);
    }

    const json = normalizeGeoJson(await response.json());
    worldDataCache.set(sourceUrl, json);
    return json;
  })().finally(() => {
    worldInFlightCache.delete(sourceUrl);
  });

  worldInFlightCache.set(sourceUrl, request);
  return request;
}
