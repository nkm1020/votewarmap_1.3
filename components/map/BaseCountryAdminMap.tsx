'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FeatureCollection, Geometry } from 'geojson';
import maplibregl, { type ExpressionSpecification, type GeoJSONSource } from 'maplibre-gl';
import { Layers3Icon, MapIcon, MapPinnedIcon } from 'lucide-react';
import type { RegionVoteMap, RegionVoteStat, RegionWinner } from '@/components/KoreaAdminMap';
import { buildCountryDummyStats } from '@/lib/map/countryDummyStats';
import {
  getCountryLevelOrder,
  getDefaultCountryLevel,
  getCountryMapConfig,
  SUPPORTED_COUNTRY_TABS,
  type CountryMapLevel,
  type SupportedCountry,
} from '@/lib/map/countryMapRegistry';
import { detectActiveCountryByCenter, buildCountrySpatialIndex, type CountrySpatialIndex } from '@/lib/map/countrySpatialIndex';
import { getCachedGeoJson, loadGeoJsonForLevel, loadWorldSupportedCountriesGeo } from '@/lib/map/geoJsonLoader';

type MapTheme = 'light' | 'dark';
type MapFillMode = 'winner' | 'activity' | 'locked';

type MapColors = {
  a: string;
  b: string;
  tie: string;
  neutral: string;
};

export type BaseCountryTooltipContext = {
  country: SupportedCountry;
  code: string;
  name: string;
  level: CountryMapLevel;
  levelLabel: string;
  stat?: RegionVoteStat;
  isPinned: boolean;
  x: number;
  y: number;
};

export type MapViewRequest = {
  id: string;
  center: [number, number];
  zoom: number;
  reason?: 'my-region-focus' | 'reset';
};

export interface BaseCountryAdminMapProps {
  country: SupportedCountry;
  enableWorldNavigation?: boolean;
  statsByCode?: RegionVoteMap;
  defaultRegionLevel?: CountryMapLevel;
  className?: string;
  height?: number | string;
  initialCenter?: [number, number];
  initialZoom?: number;
  bottomDockHeightPx?: number;
  toggleClearancePx?: number;
  colors?: Partial<MapColors>;
  theme?: MapTheme;
  showTooltip?: boolean;
  tooltipPinOnClick?: boolean;
  renderTooltipContent?: (context: BaseCountryTooltipContext) => ReactNode;
  onTooltipRegionChange?: (context: BaseCountryTooltipContext | null) => void;
  showNavigationControl?: boolean;
  showRegionLevelToggle?: boolean;
  regionLevelToggleAlign?: 'left' | 'right';
  fillMode?: MapFillMode;
  onRegionClick?: (region: { code: string; name: string; level: CountryMapLevel; stat?: RegionVoteStat }) => void;
  onMapPointerDown?: () => void;
  onActiveCountryChange?: (country: SupportedCountry) => void;
  onCountrySwitchSource?: (source: 'pan' | 'tab') => void;
  viewRequest?: MapViewRequest;
  countryFocusOffsetPx?: [number, number];
}

type HoveredRegion = {
  code: string;
  name: string;
  level: CountryMapLevel;
  x: number;
  y: number;
  stat?: RegionVoteStat;
};

const EMPTY_FEATURE_COLLECTION: FeatureCollection<Geometry> = {
  type: 'FeatureCollection',
  features: [],
};

const SOURCE_BY_LEVEL: Record<CountryMapLevel, string> = {
  l1: 'base-country-l1',
  l2: 'base-country-l2',
  l3: 'base-country-l3',
};

const FILL_LAYER_BY_LEVEL: Record<CountryMapLevel, string> = {
  l1: 'base-country-l1-fill',
  l2: 'base-country-l2-fill',
  l3: 'base-country-l3-fill',
};

const BORDER_LAYER_BY_LEVEL: Record<CountryMapLevel, string> = {
  l1: 'base-country-l1-border',
  l2: 'base-country-l2-border',
  l3: 'base-country-l3-border',
};

const WORLD_SOURCE_ID = 'base-world-countries';
const WORLD_FILL_LAYER_ID = 'world-country-fill';
const WORLD_BORDER_LAYER_ID = 'world-country-border';
const WORLD_SWITCH_DEBOUNCE_MS = 100;
const PAN_SWITCH_LOCK_AFTER_TAB_MS = 900;
const ENTER_ZOOM_EPSILON = 0.04;
const MOBILE_BREAKPOINT_PX = 768;
const KR_MOBILE_ZOOM_OUT_DELTA = 0.45;

const DEFAULT_COLORS: MapColors = {
  a: 'rgba(233, 73, 73, 0.72)',
  b: 'rgba(36, 117, 255, 0.72)',
  tie: 'rgba(255, 187, 0, 0.72)',
  neutral: 'rgba(115, 115, 115, 0.35)',
};

const DARK_THEME_COLORS: MapColors = {
  a: 'rgba(255, 128, 52, 0.76)',
  b: 'rgba(77, 156, 255, 0.76)',
  tie: 'rgba(255, 203, 99, 0.72)',
  neutral: 'rgba(26, 43, 60, 0.22)',
};

const THEME_STYLES = {
  light: {
    background: '#f8fafc',
    majorBorder: 'rgba(31,41,55,0.45)',
    minorBorder: 'rgba(31,41,55,0.3)',
    wrapperClass: 'border-slate-200 bg-white',
    tooltipClass: 'bg-slate-900/95 text-white',
    tooltipSubClass: 'text-slate-300',
  },
  dark: {
    background: '#5e8399',
    majorBorder: 'rgba(201,221,251,0.55)',
    minorBorder: 'rgba(187,210,244,0.4)',
    wrapperClass: 'border-white/18 bg-[#5e8399]/35',
    tooltipClass: 'border border-white/16 bg-[rgba(10,16,24,0.85)] text-white backdrop-blur-md',
    tooltipSubClass: 'text-white/70',
  },
} as const;

const TOGGLE_THEME_STYLES = {
  light: {
    wrapper:
      'border-slate-200/90 bg-[rgba(255,255,255,0.9)] shadow-[0_10px_24px_rgba(148,163,184,0.22)] backdrop-blur-md',
    active: 'border border-slate-300/90 bg-slate-900/[0.06] text-slate-900',
    inactive: 'text-slate-500 hover:bg-slate-900/[0.04] hover:text-slate-800',
  },
  dark: {
    wrapper: 'border-white/24 bg-[rgba(10,16,24,0.7)] shadow-[0_10px_24px_rgba(0,0,0,0.32)] backdrop-blur-md',
    active: 'border border-white/30 bg-white/14 text-white',
    inactive: 'text-white/62 hover:text-white/88',
  },
} as const;

const LOCKED_FILL_COLOR = 'rgba(122, 142, 165, 0.52)';

function emitMapMetric(event: string, payload: Record<string, unknown>): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(
    new CustomEvent('map:metric', {
      detail: { event, ...payload },
    }),
  );
}

function getDefaultColors(theme: MapTheme): MapColors {
  return theme === 'dark' ? DARK_THEME_COLORS : DEFAULT_COLORS;
}

function normalizeCode(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function resolveWinner(stat?: RegionVoteStat): RegionWinner {
  if (!stat) {
    return 'TIE';
  }

  if (stat.winner) {
    return stat.winner;
  }

  const a = stat.countA ?? 0;
  const b = stat.countB ?? 0;
  if (a > b) {
    return 'A';
  }
  if (b > a) {
    return 'B';
  }
  return 'TIE';
}

function buildActivityFillColor(intensity: number): string {
  const clamped = Math.max(0, Math.min(1, intensity));
  const from = [34, 49, 69];
  const to = [101, 176, 255];
  const r = Math.round(from[0] + (to[0] - from[0]) * clamped);
  const g = Math.round(from[1] + (to[1] - from[1]) * clamped);
  const b = Math.round(from[2] + (to[2] - from[2]) * clamped);
  const alpha = (0.18 + clamped * 0.72).toFixed(3);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildFillExpression(
  statsByCode: RegionVoteMap,
  colors: MapColors,
  fillMode: MapFillMode,
  allowedCodes: Set<string>,
): ExpressionSpecification {
  const featureCode: ExpressionSpecification = ['to-string', ['coalesce', ['get', 'code'], ['id']]];
  const entries: string[] = [];

  const targetEntries = Object.entries(statsByCode).filter(([code]) => allowedCodes.has(code));

  if (fillMode === 'locked') {
    targetEntries.forEach(([code]) => {
      entries.push(code, LOCKED_FILL_COLOR);
    });

    if (entries.length === 0) {
      return ['match', featureCode, '__no_stats__', LOCKED_FILL_COLOR, LOCKED_FILL_COLOR] as ExpressionSpecification;
    }

    return ['match', featureCode, ...entries, LOCKED_FILL_COLOR] as ExpressionSpecification;
  }

  if (fillMode === 'activity') {
    const maxTotal = targetEntries.reduce((max, [, stat]) => {
      const total = Math.max(0, stat.total ?? 0);
      return Math.max(max, total);
    }, 0);

    targetEntries.forEach(([code, stat]) => {
      const total = Math.max(0, stat.total ?? 0);
      const intensity = maxTotal > 0 ? total / maxTotal : 0;
      entries.push(code, buildActivityFillColor(intensity));
    });
  } else {
    targetEntries.forEach(([code, stat]) => {
      const winner = resolveWinner(stat);
      const fill = winner === 'A' ? colors.a : winner === 'B' ? colors.b : colors.tie;
      entries.push(code, fill);
    });
  }

  if (entries.length === 0) {
    return ['match', featureCode, '__no_stats__', colors.neutral, colors.neutral] as ExpressionSpecification;
  }

  return ['match', featureCode, ...entries, colors.neutral] as ExpressionSpecification;
}

function buildFillOpacityExpression(baseOpacity: number): ExpressionSpecification {
  const safeBase = Math.max(0, Math.min(1, baseOpacity));
  const hoverOpacity = Math.max(safeBase, Math.min(1, safeBase + 0.16));
  return ['case', ['boolean', ['feature-state', 'hover'], false], hoverOpacity, safeBase] as ExpressionSpecification;
}

function resolveDefaultLevel(country: SupportedCountry, requested?: CountryMapLevel): CountryMapLevel {
  const config = getCountryMapConfig(country);
  if (requested && config.levels[requested]) {
    return requested;
  }
  return getDefaultCountryLevel(country);
}

function getEnterZoom(country: SupportedCountry): number {
  const config = getCountryMapConfig(country);
  if (typeof config.enterZoom === 'number') {
    return config.enterZoom;
  }
  return Math.max(3.8, config.zoomThresholds.l2 - 0.3);
}

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches;
  }
  return window.innerWidth <= MOBILE_BREAKPOINT_PX;
}

function resolveResponsiveDefaultZoom(country: SupportedCountry, defaultZoom: number): number {
  if (country !== 'KR') {
    return defaultZoom;
  }
  if (!isMobileViewport()) {
    return defaultZoom;
  }
  return defaultZoom - KR_MOBILE_ZOOM_OUT_DELTA;
}

function normalizeLongitude(lng: number): number {
  if (!Number.isFinite(lng)) {
    return lng;
  }
  const normalized = ((lng + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
}

function normalizeOffset(offset?: [number, number]): [number, number] {
  if (!Array.isArray(offset)) {
    return [0, 0];
  }
  const x = Number.isFinite(offset[0]) ? offset[0] : 0;
  const y = Number.isFinite(offset[1]) ? offset[1] : 0;
  return [x, y];
}

function buildWorldFillExpression(activeCountry: SupportedCountry, theme: MapTheme): ExpressionSpecification {
  const featureCode: ExpressionSpecification = ['to-string', ['coalesce', ['get', 'code'], ['id']]];
  const active = theme === 'dark' ? 'rgba(96, 165, 250, 0.35)' : 'rgba(59, 130, 246, 0.28)';
  const inactive = theme === 'dark' ? 'rgba(148, 163, 184, 0.08)' : 'rgba(100, 116, 139, 0.06)';
  return ['match', featureCode, activeCountry, active, inactive] as ExpressionSpecification;
}

export default function BaseCountryAdminMap({
  country,
  enableWorldNavigation = false,
  statsByCode,
  defaultRegionLevel,
  className,
  height = 640,
  initialCenter,
  initialZoom,
  bottomDockHeightPx = 132,
  toggleClearancePx = 14,
  colors,
  theme = 'light',
  showTooltip = true,
  tooltipPinOnClick = true,
  renderTooltipContent,
  onTooltipRegionChange,
  showNavigationControl = true,
  showRegionLevelToggle = true,
  regionLevelToggleAlign = 'left',
  fillMode = 'winner',
  onRegionClick,
  onMapPointerDown,
  onActiveCountryChange,
  onCountrySwitchSource,
  viewRequest,
  countryFocusOffsetPx,
}: BaseCountryAdminMapProps) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReadyRef = useRef(false);
  const selectedLevelRef = useRef<CountryMapLevel>(resolveDefaultLevel(country, defaultRegionLevel));
  const activeLevelRef = useRef<CountryMapLevel>(resolveDefaultLevel(country, defaultRegionLevel));
  const currentCountryRef = useRef<SupportedCountry>(country);
  const levelCodesRef = useRef<Record<CountryMapLevel, Set<string>>>({
    l1: new Set(),
    l2: new Set(),
    l3: new Set(),
  });
  const loadedLevelsRef = useRef<Record<CountryMapLevel, boolean>>({ l1: false, l2: false, l3: false });
  const statsRef = useRef<RegionVoteMap>(statsByCode ?? {});
  const hasExternalStatsRef = useRef(Boolean(statsByCode));
  const internalStatsRef = useRef<RegionVoteMap>({});
  const fillModeRef = useRef<MapFillMode>(fillMode);
  const colorsRef = useRef<MapColors>({ ...getDefaultColors(theme), ...colors });
  const hoverRef = useRef<{ source: CountryMapLevel; id: string | number } | null>(null);
  const levelSwitchRef = useRef<((level: CountryMapLevel) => void) | null>(null);
  const countryApplyRef = useRef<((countryCode: SupportedCountry, forcedLevel?: CountryMapLevel) => void) | null>(null);
  const countryRequestIdRef = useRef(0);
  const countryAbortRef = useRef<AbortController | null>(null);
  const pinnedRegionRef = useRef<HoveredRegion | null>(null);
  const onRegionClickRef = useRef(onRegionClick);
  const onMapPointerDownRef = useRef(onMapPointerDown);
  const onActiveCountryChangeRef = useRef(onActiveCountryChange);
  const onCountrySwitchSourceRef = useRef(onCountrySwitchSource);
  const countryFocusOffsetRef = useRef<[number, number]>(normalizeOffset(countryFocusOffsetPx));
  const lastAppliedViewRequestIdRef = useRef<string | null>(null);
  const spatialIndexRef = useRef<CountrySpatialIndex>([]);
  const prefetchedL1CountriesRef = useRef<Set<SupportedCountry>>(new Set());
  const moveEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panSwitchLockedUntilRef = useRef(0);
  const countryPropRef = useRef(country);
  const defaultRegionLevelRef = useRef(defaultRegionLevel);

  const [selectedLevel, setSelectedLevel] = useState<CountryMapLevel>(resolveDefaultLevel(country, defaultRegionLevel));
  const [hoveredRegion, setHoveredRegion] = useState<HoveredRegion | null>(null);
  const [pinnedRegion, setPinnedRegion] = useState<HoveredRegion | null>(null);

  const config = useMemo(() => getCountryMapConfig(country), [country]);
  const levelOrder = useMemo(() => getCountryLevelOrder(country), [country]);
  const toggleBottomOffsetPx = Math.max(120, bottomDockHeightPx + toggleClearancePx);

  const activeTooltip = pinnedRegion ?? hoveredRegion;
  const activeTooltipContext = useMemo<BaseCountryTooltipContext | null>(() => {
    if (!activeTooltip) {
      return null;
    }

    const levelLabel = config.levels[activeTooltip.level]?.label ?? activeTooltip.level;
    return {
      country,
      code: activeTooltip.code,
      name: activeTooltip.name,
      level: activeTooltip.level,
      levelLabel,
      stat: activeTooltip.stat,
      x: activeTooltip.x,
      y: activeTooltip.y,
      isPinned: Boolean(pinnedRegion),
    };
  }, [activeTooltip, config.levels, country, pinnedRegion]);

  useEffect(() => {
    onRegionClickRef.current = onRegionClick;
  }, [onRegionClick]);

  useEffect(() => {
    onMapPointerDownRef.current = onMapPointerDown;
  }, [onMapPointerDown]);

  useEffect(() => {
    onActiveCountryChangeRef.current = onActiveCountryChange;
  }, [onActiveCountryChange]);

  useEffect(() => {
    onCountrySwitchSourceRef.current = onCountrySwitchSource;
  }, [onCountrySwitchSource]);

  useEffect(() => {
    countryFocusOffsetRef.current = normalizeOffset(countryFocusOffsetPx);
  }, [countryFocusOffsetPx]);

  useEffect(() => {
    countryPropRef.current = country;
  }, [country]);

  useEffect(() => {
    defaultRegionLevelRef.current = defaultRegionLevel;
  }, [defaultRegionLevel]);

  useEffect(() => {
    selectedLevelRef.current = selectedLevel;
  }, [selectedLevel]);

  useEffect(() => {
    pinnedRegionRef.current = pinnedRegion;
  }, [pinnedRegion]);

  useEffect(() => {
    onTooltipRegionChange?.(showTooltip ? activeTooltipContext : null);
  }, [activeTooltipContext, onTooltipRegionChange, showTooltip]);

  useEffect(() => {
    return () => {
      onTooltipRegionChange?.(null);
    };
  }, [onTooltipRegionChange]);

  useEffect(() => {
    if (!showTooltip || !tooltipPinOnClick || !pinnedRegion) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }
      const mapNode = mapNodeRef.current;
      if (!mapNode) {
        return;
      }
      if (mapNode.contains(event.target)) {
        return;
      }
      setPinnedRegion(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPinnedRegion(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [pinnedRegion, showTooltip, tooltipPinOnClick]);

  useEffect(() => {
    colorsRef.current = { ...getDefaultColors(theme), ...colors };
  }, [colors, theme]);

  useEffect(() => {
    fillModeRef.current = fillMode;
  }, [fillMode]);

  useEffect(() => {
    if (!viewRequest) {
      return;
    }

    if (lastAppliedViewRequestIdRef.current === viewRequest.id) {
      return;
    }

    const map = mapRef.current;
    if (!map) {
      return;
    }

    const [lng, lat] = viewRequest.center;
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(viewRequest.zoom)) {
      return;
    }

    const applyView = () => {
      const activeConfig = getCountryMapConfig(currentCountryRef.current);
      const targetZoom = Math.max(activeConfig.minZoom, Math.min(activeConfig.maxZoom, viewRequest.zoom));
      map.easeTo({
        center: [normalizeLongitude(lng), lat],
        zoom: targetZoom,
        duration: 520,
        essential: true,
      });
    };

    lastAppliedViewRequestIdRef.current = viewRequest.id;
    if (map.isStyleLoaded()) {
      applyView();
      return;
    }

    map.once('load', applyView);
  }, [viewRequest]);

  useEffect(() => {
    hasExternalStatsRef.current = Boolean(statsByCode);
    statsRef.current = statsByCode ?? internalStatsRef.current;

    const map = mapRef.current;
    if (!map || !mapReadyRef.current) {
      return;
    }

    (['l1', 'l2', 'l3'] as CountryMapLevel[]).forEach((level) => {
      const layerId = FILL_LAYER_BY_LEVEL[level];
      if (!map.getLayer(layerId)) {
        return;
      }
      map.setPaintProperty(
        layerId,
        'fill-color',
        buildFillExpression(statsRef.current, colorsRef.current, fillMode, levelCodesRef.current[level]),
      );
    });
  }, [fillMode, statsByCode]);

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) {
      return;
    }
    currentCountryRef.current = countryPropRef.current;

    const mapStyle: maplibregl.StyleSpecification =
      theme === 'dark'
        ? {
            version: 8,
            glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
            sources: {
              'carto-dark': {
                type: 'raster',
                tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'],
                tileSize: 256,
                attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
              },
            },
            layers: [
              {
                id: 'bg',
                type: 'background',
                paint: { 'background-color': THEME_STYLES[theme].background },
              },
              {
                id: 'carto-dark',
                type: 'raster',
                source: 'carto-dark',
                paint: {
                  'raster-opacity': 0.9,
                  'raster-contrast': 0.08,
                  'raster-saturation': -0.15,
                  'raster-brightness-min': 0.06,
                  'raster-brightness-max': 0.88,
                },
              },
            ],
          }
        : {
            version: 8,
            glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
            sources: {
              'carto-light': {
                type: 'raster',
                tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'],
                tileSize: 256,
                attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
              },
            },
            layers: [
              {
                id: 'bg',
                type: 'background',
                paint: { 'background-color': THEME_STYLES[theme].background },
              },
              {
                id: 'carto-light',
                type: 'raster',
                source: 'carto-light',
                paint: {
                  'raster-opacity': 0.92,
                  'raster-contrast': 0.04,
                  'raster-saturation': -0.2,
                  'raster-brightness-min': 0.08,
                  'raster-brightness-max': 0.96,
                },
              },
            ],
          };

    const initialConfig = getCountryMapConfig(countryPropRef.current);
    const initialDefaultZoom = resolveResponsiveDefaultZoom(countryPropRef.current, initialConfig.zoom);
    const initialTargetZoom = Math.max(
      initialConfig.minZoom,
      Math.min(initialConfig.maxZoom, initialZoom ?? initialDefaultZoom),
    );
    const map = new maplibregl.Map({
      container: mapNodeRef.current,
      style: mapStyle,
      center: initialCenter ?? initialConfig.center,
      zoom: initialTargetZoom,
      minZoom: initialConfig.minZoom,
      maxZoom: initialConfig.maxZoom,
      attributionControl: false,
      dragRotate: false,
      touchPitch: false,
      renderWorldCopies: true,
    });

    if (showNavigationControl) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    }

    mapRef.current = map;

    const clearHover = () => {
      const prev = hoverRef.current;
      if (!prev) {
        return;
      }
      map.setFeatureState({ source: SOURCE_BY_LEVEL[prev.source], id: prev.id }, { hover: false });
      hoverRef.current = null;
    };

    const setLayerVisibility = (layerId: string, visible: boolean) => {
      if (!map.getLayer(layerId)) {
        return;
      }
      map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    };

    const setWorldLayerVisibility = (visible: boolean) => {
      setLayerVisibility(WORLD_FILL_LAYER_ID, visible);
      setLayerVisibility(WORLD_BORDER_LAYER_ID, visible);
    };

    const syncWorldFill = (activeCountry: SupportedCountry) => {
      if (!map.getLayer(WORLD_FILL_LAYER_ID)) {
        return;
      }
      map.setPaintProperty(WORLD_FILL_LAYER_ID, 'fill-color', buildWorldFillExpression(activeCountry, theme));
    };

    const refreshInternalStats = () => {
      const allCodes = new Set<string>();
      (['l1', 'l2', 'l3'] as CountryMapLevel[]).forEach((level) => {
        levelCodesRef.current[level].forEach((code) => allCodes.add(code));
      });
      internalStatsRef.current = buildCountryDummyStats(currentCountryRef.current, allCodes);
      if (!hasExternalStatsRef.current) {
        statsRef.current = internalStatsRef.current;
      }
    };

    const ensureLevelLoaded = async (
      level: CountryMapLevel,
      requestId: number,
      targetCountry: SupportedCountry,
      signal?: AbortSignal,
    ) => {
      const targetConfig = getCountryMapConfig(targetCountry);
      if (!targetConfig.levels[level]) {
        return;
      }

      if (loadedLevelsRef.current[level]) {
        return;
      }

      const startedAt = performance.now();
      const cacheHit = Boolean(getCachedGeoJson(targetCountry, level));
      let geoJson: FeatureCollection<Geometry>;
      try {
        geoJson = (await loadGeoJsonForLevel(
          targetCountry,
          level,
          signal,
        )) as unknown as FeatureCollection<Geometry>;
      } catch (error) {
        if (signal?.aborted || requestId !== countryRequestIdRef.current || currentCountryRef.current !== targetCountry) {
          return;
        }
        console.error(`[BaseCountryAdminMap] Failed to load ${targetCountry}:${level}`, error);
        emitMapMetric('map_level_load', {
          country: targetCountry,
          level,
          cache_hit: cacheHit,
          latency_ms: Math.round(performance.now() - startedAt),
          status: 'error',
        });
        const source = map.getSource(SOURCE_BY_LEVEL[level]) as GeoJSONSource | undefined;
        source?.setData(EMPTY_FEATURE_COLLECTION);
        levelCodesRef.current[level] = new Set<string>();
        if (map.getLayer(FILL_LAYER_BY_LEVEL[level])) {
          map.setPaintProperty(
            FILL_LAYER_BY_LEVEL[level],
            'fill-color',
            buildFillExpression(statsRef.current, colorsRef.current, fillModeRef.current, levelCodesRef.current[level]),
          );
        }
        return;
      }

      if (requestId !== countryRequestIdRef.current || currentCountryRef.current !== targetCountry) {
        return;
      }

      const source = map.getSource(SOURCE_BY_LEVEL[level]) as GeoJSONSource | undefined;
      source?.setData(geoJson);

      const nextCodes = new Set<string>();
      (geoJson.features ?? []).forEach((feature) => {
        const code = normalizeCode(feature?.properties?.code);
        if (code) {
          nextCodes.add(code);
        }
      });

      levelCodesRef.current[level] = nextCodes;
      loadedLevelsRef.current[level] = true;
      emitMapMetric('map_level_load', {
        country: targetCountry,
        level,
        cache_hit: cacheHit,
        latency_ms: Math.round(performance.now() - startedAt),
        status: 'ok',
      });

      refreshInternalStats();

      if (map.getLayer(FILL_LAYER_BY_LEVEL[level])) {
        map.setPaintProperty(
          FILL_LAYER_BY_LEVEL[level],
          'fill-color',
          buildFillExpression(statsRef.current, colorsRef.current, fillModeRef.current, nextCodes),
        );
      }
    };

    const syncLayerVisibility = async (nextLevelRaw: CountryMapLevel) => {
      const targetConfig = getCountryMapConfig(currentCountryRef.current);
      const availableLevels = getCountryLevelOrder(currentCountryRef.current);
      const nextLevel = availableLevels.includes(nextLevelRaw) ? nextLevelRaw : 'l1';

      await ensureLevelLoaded(nextLevel, countryRequestIdRef.current, currentCountryRef.current, countryAbortRef.current?.signal);

      availableLevels.forEach((level) => {
        setLayerVisibility(FILL_LAYER_BY_LEVEL[level], level === nextLevel);
        setLayerVisibility(BORDER_LAYER_BY_LEVEL[level], level === nextLevel);
      });

      activeLevelRef.current = nextLevel;
      selectedLevelRef.current = nextLevel;
      setSelectedLevel(nextLevel);
      clearHover();
      setHoveredRegion(null);
      setPinnedRegion(null);

      map.setMaxZoom(targetConfig.maxZoom);
      map.setMinZoom(targetConfig.minZoom);

      if (enableWorldNavigation) {
        const showWorld = map.getZoom() < getEnterZoom(currentCountryRef.current);
        setWorldLayerVisibility(showWorld);
        if (showWorld) {
          availableLevels.forEach((level) => {
            setLayerVisibility(FILL_LAYER_BY_LEVEL[level], false);
            setLayerVisibility(BORDER_LAYER_BY_LEVEL[level], false);
          });
        }
      } else {
        setWorldLayerVisibility(false);
      }
    };

    const registerHoverAndClick = (level: CountryMapLevel) => {
      const layerId = FILL_LAYER_BY_LEVEL[level];

      map.on('mousemove', layerId, (event) => {
        if (activeLevelRef.current !== level) {
          return;
        }

        const feature = event.features?.[0];
        if (!feature) {
          return;
        }

        const code = normalizeCode(feature.properties?.code ?? feature.id);
        const id = feature.id ?? code;
        const name = normalizeCode(feature.properties?.name);
        if (!code || !id) {
          return;
        }

        if (tooltipPinOnClick && pinnedRegionRef.current) {
          map.getCanvas().style.cursor = 'pointer';
          return;
        }

        const prev = hoverRef.current;
        if (!prev || prev.source !== level || prev.id !== id) {
          clearHover();
          map.setFeatureState({ source: SOURCE_BY_LEVEL[level], id }, { hover: true });
          hoverRef.current = { source: level, id };
        }

        map.getCanvas().style.cursor = 'pointer';
        if (showTooltip) {
          setHoveredRegion({
            code,
            name: name || code,
            level,
            x: event.point.x + 14,
            y: event.point.y + 14,
            stat: statsRef.current[code],
          });
        }
      });

      map.on('mouseleave', layerId, () => {
        if (activeLevelRef.current !== level) {
          return;
        }
        clearHover();
        map.getCanvas().style.cursor = '';
        if (showTooltip) {
          setHoveredRegion(null);
        }
      });

      map.on('click', layerId, (event) => {
        if (activeLevelRef.current !== level) {
          return;
        }

        const feature = event.features?.[0];
        if (!feature) {
          return;
        }

        const code = normalizeCode(feature.properties?.code ?? feature.id);
        const name = normalizeCode(feature.properties?.name) || code;
        if (!code) {
          return;
        }

        if (showTooltip && tooltipPinOnClick) {
          setPinnedRegion({
            code,
            name,
            level,
            x: event.point.x + 14,
            y: event.point.y + 14,
            stat: statsRef.current[code],
          });
        }

        onRegionClickRef.current?.({
          code,
          name,
          level,
          stat: statsRef.current[code],
        });
      });
    };

    const applyCountry = async (
      targetCountry: SupportedCountry,
      forcedLevel?: CountryMapLevel,
      options?: {
        source?: 'tab' | 'pan';
        recenter?: boolean;
      },
    ) => {
      const prevCountry = currentCountryRef.current;
      const requestId = countryRequestIdRef.current + 1;
      countryRequestIdRef.current = requestId;
      countryAbortRef.current?.abort();
      if (moveEndTimerRef.current) {
        clearTimeout(moveEndTimerRef.current);
        moveEndTimerRef.current = null;
      }
      if (options?.source === 'tab') {
        panSwitchLockedUntilRef.current = Date.now() + PAN_SWITCH_LOCK_AFTER_TAB_MS;
      }
      countryAbortRef.current = new AbortController();

      currentCountryRef.current = targetCountry;
      loadedLevelsRef.current = { l1: false, l2: false, l3: false };
      levelCodesRef.current = { l1: new Set(), l2: new Set(), l3: new Set() };
      internalStatsRef.current = {};
      if (!hasExternalStatsRef.current) {
        statsRef.current = {};
      }

      (['l1', 'l2', 'l3'] as CountryMapLevel[]).forEach((level) => {
        const source = map.getSource(SOURCE_BY_LEVEL[level]) as GeoJSONSource | undefined;
        source?.setData(EMPTY_FEATURE_COLLECTION);
      });

      const targetConfig = getCountryMapConfig(targetCountry);
      if (options?.recenter) {
        const targetCenter: [number, number] = [
          normalizeLongitude(targetConfig.center[0]),
          targetConfig.center[1],
        ];
        const targetDefaultZoom = resolveResponsiveDefaultZoom(targetCountry, targetConfig.zoom);
        const targetZoomBase = enableWorldNavigation
          ? Math.max(targetDefaultZoom, getEnterZoom(targetCountry) + ENTER_ZOOM_EPSILON)
          : targetDefaultZoom;
        const targetZoom = Math.max(targetConfig.minZoom, Math.min(targetConfig.maxZoom, targetZoomBase));
        map.flyTo({
          center: targetCenter,
          zoom: targetZoom,
          offset: countryFocusOffsetRef.current,
          duration: 420,
          essential: true,
        });
      }

      await ensureLevelLoaded('l1', requestId, targetCountry, countryAbortRef.current.signal);
      if (requestId !== countryRequestIdRef.current) {
        return;
      }

      const targetLevel = resolveDefaultLevel(targetCountry, forcedLevel ?? defaultRegionLevelRef.current);
      await syncLayerVisibility(targetLevel);
      syncWorldFill(targetCountry);
      onActiveCountryChangeRef.current?.(targetCountry);

      if (options?.source) {
        onCountrySwitchSourceRef.current?.(options.source);
        emitMapMetric('map_country_switch', {
          from: prevCountry,
          to: targetCountry,
          source: options.source,
        });
      }
    };

    map.on('mousedown', () => {
      onMapPointerDownRef.current?.();
    });

    map.on('touchstart', () => {
      onMapPointerDownRef.current?.();
    });

    map.on('load', () => {
      const themeStyle = THEME_STYLES[theme];

      map.addSource(WORLD_SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_FEATURE_COLLECTION,
        promoteId: 'code',
      });

      map.addLayer({
        id: WORLD_FILL_LAYER_ID,
        type: 'fill',
        source: WORLD_SOURCE_ID,
        layout: { visibility: enableWorldNavigation ? 'visible' : 'none' },
        paint: {
          'fill-color': buildWorldFillExpression(currentCountryRef.current, theme),
          'fill-opacity': 0.65,
        },
      });

      map.addLayer({
        id: WORLD_BORDER_LAYER_ID,
        type: 'line',
        source: WORLD_SOURCE_ID,
        layout: { visibility: enableWorldNavigation ? 'visible' : 'none' },
        paint: {
          'line-color': theme === 'dark' ? 'rgba(217, 232, 255, 0.42)' : 'rgba(51, 65, 85, 0.34)',
          'line-width': 0.85,
          'line-opacity': 1,
        },
      });

      (['l1', 'l2', 'l3'] as CountryMapLevel[]).forEach((level) => {
        map.addSource(SOURCE_BY_LEVEL[level], {
          type: 'geojson',
          data: EMPTY_FEATURE_COLLECTION,
          promoteId: 'code',
        });

        map.addLayer({
          id: FILL_LAYER_BY_LEVEL[level],
          type: 'fill',
          source: SOURCE_BY_LEVEL[level],
          layout: { visibility: 'none' },
          paint: {
            'fill-color': buildFillExpression(statsRef.current, colorsRef.current, fillModeRef.current, new Set()),
            'fill-opacity': buildFillOpacityExpression(level === 'l1' ? 0.74 : level === 'l2' ? 0.7 : 0.68),
          },
        });

        map.addLayer({
          id: BORDER_LAYER_BY_LEVEL[level],
          type: 'line',
          source: SOURCE_BY_LEVEL[level],
          layout: { visibility: 'none' },
          paint: {
            'line-color': level === 'l1' ? themeStyle.majorBorder : themeStyle.minorBorder,
            'line-width': level === 'l1' ? (theme === 'dark' ? 1.2 : 1.1) : theme === 'dark' ? 0.94 : 0.78,
            'line-opacity': 1,
          },
        });

        registerHoverAndClick(level);
      });

      void (async () => {
        try {
          const worldGeo = (await loadWorldSupportedCountriesGeo()) as unknown as FeatureCollection<Geometry>;
          const worldSource = map.getSource(WORLD_SOURCE_ID) as GeoJSONSource | undefined;
          worldSource?.setData(worldGeo);
          spatialIndexRef.current = buildCountrySpatialIndex(worldGeo);
        } catch (error) {
          console.error('[BaseCountryAdminMap] Failed to load world supported countries geo', error);
        }
      })();

      mapReadyRef.current = true;
      levelSwitchRef.current = (nextLevel: CountryMapLevel) => {
        void syncLayerVisibility(nextLevel);
      };
      countryApplyRef.current = (targetCountry, forcedLevel) => {
        void applyCountry(targetCountry, forcedLevel, { source: 'tab', recenter: true });
      };

      const currentCountry = currentCountryRef.current;
      void applyCountry(currentCountry, resolveDefaultLevel(currentCountry, defaultRegionLevelRef.current), {
        recenter: enableWorldNavigation,
      });
    });

    map.on('zoomend', () => {
      if (enableWorldNavigation) {
        const availableLevels = getCountryLevelOrder(currentCountryRef.current);
        const showWorld = map.getZoom() < getEnterZoom(currentCountryRef.current);
        setWorldLayerVisibility(showWorld);
        if (showWorld) {
          availableLevels.forEach((level) => {
            setLayerVisibility(FILL_LAYER_BY_LEVEL[level], false);
            setLayerVisibility(BORDER_LAYER_BY_LEVEL[level], false);
          });
          return;
        }

        const fallbackLevel = resolveDefaultLevel(currentCountryRef.current, defaultRegionLevelRef.current);
        const activeLevel = availableLevels.includes(activeLevelRef.current) ? activeLevelRef.current : fallbackLevel;
        if (activeLevel !== activeLevelRef.current || activeLevel !== selectedLevelRef.current) {
          activeLevelRef.current = activeLevel;
          selectedLevelRef.current = activeLevel;
          setSelectedLevel(activeLevel);
        }
        availableLevels.forEach((level) => {
          const visible = level === activeLevel;
          setLayerVisibility(FILL_LAYER_BY_LEVEL[level], visible);
          setLayerVisibility(BORDER_LAYER_BY_LEVEL[level], visible);
        });
      }
    });

    map.on('moveend', () => {
      if (!enableWorldNavigation || !mapReadyRef.current) {
        return;
      }
      if (Date.now() < panSwitchLockedUntilRef.current) {
        return;
      }

      if (moveEndTimerRef.current) {
        clearTimeout(moveEndTimerRef.current);
      }

      moveEndTimerRef.current = setTimeout(() => {
        moveEndTimerRef.current = null;
        if (Date.now() < panSwitchLockedUntilRef.current) {
          return;
        }
        const center = map.getCenter();
        const nextCountry = detectActiveCountryByCenter(
          spatialIndexRef.current,
          [center.lng, center.lat],
          currentCountryRef.current,
        );
        if (!nextCountry || nextCountry === currentCountryRef.current) {
          return;
        }

        const targetLevel = resolveDefaultLevel(nextCountry, selectedLevelRef.current);
        void applyCountry(nextCountry, targetLevel, { source: 'pan', recenter: false });
      }, WORLD_SWITCH_DEBOUNCE_MS);
    });

    return () => {
      mapReadyRef.current = false;
      countryAbortRef.current?.abort();
      if (moveEndTimerRef.current) {
        clearTimeout(moveEndTimerRef.current);
        moveEndTimerRef.current = null;
      }
      countryApplyRef.current = null;
      levelSwitchRef.current = null;
      setHoveredRegion(null);
      setPinnedRegion(null);
      pinnedRegionRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [
    enableWorldNavigation,
    initialCenter,
    initialZoom,
    showNavigationControl,
    showTooltip,
    theme,
    tooltipPinOnClick,
  ]);

  useEffect(() => {
    if (!mapReadyRef.current) {
      const fallbackLevel = resolveDefaultLevel(country, defaultRegionLevel);
      currentCountryRef.current = country;
      selectedLevelRef.current = fallbackLevel;
      activeLevelRef.current = fallbackLevel;
      return;
    }
    if (country === currentCountryRef.current) {
      return;
    }

    const nextLevel = resolveDefaultLevel(country, selectedLevelRef.current);
    countryApplyRef.current?.(country, nextLevel);
  }, [country, defaultRegionLevel]);

  useEffect(() => {
    if (!enableWorldNavigation || typeof window === 'undefined') {
      return;
    }

    const nav = navigator as Navigator & {
      connection?: {
        saveData?: boolean;
        effectiveType?: string;
      };
    };
    if (nav.connection?.saveData || String(nav.connection?.effectiveType ?? '').includes('2g')) {
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;

    const prefetch = async () => {
      for (const item of SUPPORTED_COUNTRY_TABS) {
        if (cancelled) {
          return;
        }
        const targetCountry = item.code;
        if (targetCountry === currentCountryRef.current || prefetchedL1CountriesRef.current.has(targetCountry)) {
          continue;
        }

        const startedAt = performance.now();
        const cacheHit = Boolean(getCachedGeoJson(targetCountry, 'l1'));
        try {
          await loadGeoJsonForLevel(targetCountry, 'l1');
          prefetchedL1CountriesRef.current.add(targetCountry);
          emitMapMetric('map_level_load', {
            country: targetCountry,
            level: 'l1',
            cache_hit: cacheHit,
            latency_ms: Math.round(performance.now() - startedAt),
            status: 'ok',
            source: 'idle_prefetch',
          });
        } catch {
          emitMapMetric('map_level_load', {
            country: targetCountry,
            level: 'l1',
            cache_hit: cacheHit,
            latency_ms: Math.round(performance.now() - startedAt),
            status: 'error',
            source: 'idle_prefetch',
          });
        }
      }
    };

    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(() => {
        void prefetch();
      });
    } else {
      timeoutId = setTimeout(() => {
        void prefetch();
      }, 260);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [country, enableWorldNavigation]);

  const handleSelectLevel = (level: CountryMapLevel) => {
    levelSwitchRef.current?.(level);
  };

  const levelToggleOptions = levelOrder.map((level) => {
    const label = config.levels[level]?.label ?? level;
    if (level === 'l1') {
      return { value: level, label, icon: MapPinnedIcon };
    }
    if (level === 'l2') {
      return { value: level, label, icon: MapIcon };
    }
    return { value: level, label, icon: Layers3Icon };
  });

  return (
    <div
      className={`relative z-0 overflow-hidden rounded-2xl border ${THEME_STYLES[theme].wrapperClass} ${className ?? ''}`}
    >
      <div ref={mapNodeRef} className="relative z-0" style={{ width: '100%', height }} />

      {showRegionLevelToggle ? (
        <div
          className={`pointer-events-auto absolute z-10 inline-flex items-center overflow-hidden rounded-2xl border p-1 ${
            TOGGLE_THEME_STYLES[theme].wrapper
          } ${
            regionLevelToggleAlign === 'right' ? 'right-3' : 'left-3'
          }`}
          style={{ bottom: `${toggleBottomOffsetPx}px` }}
          role="radiogroup"
          aria-label="국가별 행정 레벨 토글"
        >
          {levelToggleOptions.map((option) => {
            const active = selectedLevel === option.value;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`${option.label} 보기`}
                onClick={() => handleSelectLevel(option.value)}
                className={`relative inline-flex h-11 min-w-[58px] items-center justify-center gap-1 rounded-xl px-2.5 text-[12px] font-semibold transition ${
                  active ? TOGGLE_THEME_STYLES[theme].active : TOGGLE_THEME_STYLES[theme].inactive
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {showTooltip && activeTooltipContext ? (
        <div
          className={`absolute z-10 shadow-lg ${activeTooltipContext.isPinned ? 'pointer-events-auto' : 'pointer-events-none'} ${
            renderTooltipContent
              ? ''
              : `rounded-md px-2.5 py-1.5 text-xs font-medium ${THEME_STYLES[theme].tooltipClass}`
          }`}
          style={{
            left: activeTooltipContext.x,
            top: activeTooltipContext.y,
          }}
        >
          {renderTooltipContent ? (
            renderTooltipContent(activeTooltipContext)
          ) : (
            <>
              <div>{activeTooltipContext.name || activeTooltipContext.code}</div>
              <div className={`text-[11px] ${THEME_STYLES[theme].tooltipSubClass}`}>
                {activeTooltipContext.levelLabel} · {activeTooltipContext.code}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
