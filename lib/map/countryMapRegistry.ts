export type SupportedCountry = 'KR' | 'US' | 'JP' | 'CN' | 'UK' | 'IE' | 'DE' | 'FR' | 'IT';

export type CountryMapLevel = 'l1' | 'l2' | 'l3';

export type CountryMapLevelConfig = {
  label: string;
  sourceUrl: string;
};

export type CountryMapConfig = {
  country: SupportedCountry;
  displayName: string;
  worldPolygonCode: SupportedCountry;
  center: [number, number];
  zoom: number;
  enterZoom?: number;
  minZoom: number;
  maxZoom: number;
  autoSwitchLevelByZoom?: boolean;
  zoomThresholds: {
    l2: number;
    l3?: number;
  };
  levels: Partial<Record<CountryMapLevel, CountryMapLevelConfig>>;
  defaultLevel: CountryMapLevel;
};

const MAP_DATA_VERSION = '20260301-eu6-ie-split';

function mapDataUrl(path: string): string {
  return `${path}?v=${MAP_DATA_VERSION}`;
}

const WORLD_SUPPORTED_COUNTRIES_GEO_URL = mapDataUrl('/data/world_supported_countries_geo.json');

const COUNTRY_CONFIGS: Record<SupportedCountry, CountryMapConfig> = {
  KR: {
    country: 'KR',
    displayName: '한국',
    worldPolygonCode: 'KR',
    center: [127.75, 36.18],
    zoom: 6.35,
    enterZoom: 4.7,
    minZoom: 4,
    maxZoom: 11,
    zoomThresholds: { l2: 7.2 },
    levels: {
      l1: { label: '시도', sourceUrl: mapDataUrl('/data/skorea_provinces_geo_simple.json') },
      l2: { label: '시군구', sourceUrl: mapDataUrl('/data/skorea_municipalities_geo_simple.json') },
    },
    defaultLevel: 'l2',
  },
  US: {
    country: 'US',
    displayName: '미국',
    worldPolygonCode: 'US',
    center: [-98.5, 39.8],
    zoom: 2.95,
    enterZoom: 3.6,
    minZoom: 2.1,
    maxZoom: 9.8,
    zoomThresholds: { l2: 5.35 },
    levels: {
      l1: { label: '주(State)', sourceUrl: mapDataUrl('/data/us_states_geo_sample.json') },
      l2: { label: '카운티(County)', sourceUrl: mapDataUrl('/data/us_counties_geo_sample.json') },
    },
    defaultLevel: 'l1',
  },
  JP: {
    country: 'JP',
    displayName: '일본',
    worldPolygonCode: 'JP',
    center: [138.25, 37.55],
    zoom: 4.1,
    enterZoom: 4.7,
    minZoom: 3.1,
    maxZoom: 9.8,
    zoomThresholds: { l2: 5.05 },
    levels: {
      l1: { label: '지방(Region)', sourceUrl: mapDataUrl('/data/jp_regions_geo_sample.json') },
      l2: { label: '도도부현', sourceUrl: mapDataUrl('/data/jp_prefectures_geo_sample.json') },
    },
    defaultLevel: 'l1',
  },
  CN: {
    country: 'CN',
    displayName: '중국',
    worldPolygonCode: 'CN',
    center: [104.0, 35.8],
    zoom: 3.25,
    enterZoom: 4.3,
    minZoom: 2.4,
    maxZoom: 9.8,
    zoomThresholds: { l2: 4.95 },
    levels: {
      l1: { label: '성급(성/직할시)', sourceUrl: mapDataUrl('/data/cn_provinces_geo_sample.json') },
      l2: { label: '지급시/구군', sourceUrl: mapDataUrl('/data/cn_prefectures_geo_sample.json') },
    },
    defaultLevel: 'l1',
  },
  UK: {
    country: 'UK',
    displayName: '영국',
    worldPolygonCode: 'UK',
    center: [-3.5, 55.4],
    zoom: 4.55,
    enterZoom: 4.9,
    minZoom: 3.5,
    maxZoom: 9.8,
    autoSwitchLevelByZoom: false,
    zoomThresholds: { l2: 5.15, l3: 6.25 },
    levels: {
      l1: { label: '구성국', sourceUrl: mapDataUrl('/data/uk_countries_geo_sample.json') },
      l2: { label: '권역', sourceUrl: mapDataUrl('/data/uk_regions_geo_sample.json') },
      l3: { label: '지자체', sourceUrl: mapDataUrl('/data/uk_local_authorities_geo_sample.json') },
    },
    defaultLevel: 'l2',
  },
  IE: {
    country: 'IE',
    displayName: '아일랜드',
    worldPolygonCode: 'IE',
    center: [-8.15, 53.35],
    zoom: 5.55,
    enterZoom: 5.9,
    minZoom: 4.4,
    maxZoom: 10,
    zoomThresholds: { l2: 6.45 },
    levels: {
      l1: { label: '주(Province)', sourceUrl: mapDataUrl('/data/ie_provinces_geo_sample.json') },
      l2: { label: '카운티(County)', sourceUrl: mapDataUrl('/data/ie_counties_geo_sample.json') },
    },
    defaultLevel: 'l1',
  },
  DE: {
    country: 'DE',
    displayName: '독일',
    worldPolygonCode: 'DE',
    center: [10.4, 51.1],
    zoom: 4.6,
    enterZoom: 5.2,
    minZoom: 3.4,
    maxZoom: 10,
    zoomThresholds: { l2: 6.1 },
    levels: {
      l1: { label: '주(Land)', sourceUrl: mapDataUrl('/data/de_states_geo_sample.json') },
      l2: { label: '군/독립시(Kreis)', sourceUrl: mapDataUrl('/data/de_kreise_geo_sample.json') },
    },
    defaultLevel: 'l1',
  },
  FR: {
    country: 'FR',
    displayName: '프랑스',
    worldPolygonCode: 'FR',
    center: [2.4, 46.6],
    zoom: 4.7,
    enterZoom: 5.25,
    minZoom: 3.3,
    maxZoom: 10,
    zoomThresholds: { l2: 6.0 },
    levels: {
      l1: { label: '레지옹(Region)', sourceUrl: mapDataUrl('/data/fr_regions_geo_sample.json') },
      l2: { label: '데파르트망(Department)', sourceUrl: mapDataUrl('/data/fr_departments_geo_sample.json') },
    },
    defaultLevel: 'l1',
  },
  IT: {
    country: 'IT',
    displayName: '이탈리아',
    worldPolygonCode: 'IT',
    center: [12.5, 42.8],
    zoom: 5.1,
    enterZoom: 5.6,
    minZoom: 3.8,
    maxZoom: 10,
    zoomThresholds: { l2: 6.45 },
    levels: {
      l1: { label: '레조네(Region)', sourceUrl: mapDataUrl('/data/it_regions_geo_sample.json') },
      l2: { label: '프로빈차(Province)', sourceUrl: mapDataUrl('/data/it_provinces_geo_sample.json') },
    },
    defaultLevel: 'l1',
  },
};

export const SUPPORTED_COUNTRY_TABS: Array<{ code: SupportedCountry; label: string }> = [
  { code: 'KR', label: 'KR' },
  { code: 'US', label: 'US' },
  { code: 'JP', label: 'JP' },
  { code: 'CN', label: 'CN' },
  { code: 'UK', label: 'UK' },
  { code: 'IE', label: 'IE' },
  { code: 'DE', label: 'DE' },
  { code: 'FR', label: 'FR' },
  { code: 'IT', label: 'IT' },
];

const COUNTRY_ALIASES: Record<string, SupportedCountry> = {
  KR: 'KR',
  US: 'US',
  JP: 'JP',
  CN: 'CN',
  UK: 'UK',
  IE: 'IE',
  DE: 'DE',
  FR: 'FR',
  IT: 'IT',
  GB: 'UK',
  GBR: 'UK',
  IRL: 'IE',
  EIRE: 'IE',
  DEU: 'DE',
  GER: 'DE',
  FRA: 'FR',
  ITA: 'IT',
};

export function resolveSupportedCountry(rawCountryCode: string | null | undefined): SupportedCountry {
  const normalized = String(rawCountryCode ?? '').trim().toUpperCase();
  return COUNTRY_ALIASES[normalized] ?? 'KR';
}

export function getCountryMapConfig(country: SupportedCountry): CountryMapConfig {
  return COUNTRY_CONFIGS[country];
}

export function getCountryLevelOrder(country: SupportedCountry): CountryMapLevel[] {
  const config = getCountryMapConfig(country);
  return ['l1', 'l2', 'l3'].filter((level) => Boolean(config.levels[level as CountryMapLevel])) as CountryMapLevel[];
}

export function getDefaultCountryLevel(country: SupportedCountry): CountryMapLevel {
  const config = getCountryMapConfig(country);
  if (config.levels[config.defaultLevel]) {
    return config.defaultLevel;
  }
  return 'l1';
}

export function getWorldSupportedCountriesGeoUrl(): string {
  return WORLD_SUPPORTED_COUNTRIES_GEO_URL;
}
