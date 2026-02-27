'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FeatureCollection, Geometry } from 'geojson';
import maplibregl, { type ExpressionSpecification, type GeoJSONSource } from 'maplibre-gl';
import { Layers3Icon, MapIcon, MapPinnedIcon } from 'lucide-react';
import cnCountryGeoRaw from '@/public/data/cn_country_geo_sample.json';
import cnProvincesGeoRaw from '@/public/data/cn_provinces_geo_sample.json';
import cnPrefecturesGeoRaw from '@/public/data/cn_prefectures_geo_sample.json';

export type RegionLevel = 'country' | 'province' | 'prefecture';
export type RegionWinner = 'A' | 'B' | 'TIE';

type MapTheme = 'light' | 'dark';
type MapFillMode = 'winner' | 'activity' | 'locked';

export type RegionVoteStat = {
  winner?: RegionWinner;
  total?: number;
  countA?: number;
  countB?: number;
  gapPercent?: number;
};

export type RegionVoteMap = Record<string, RegionVoteStat>;

export type MapTooltipContext = {
  code: string;
  name: string;
  level: RegionLevel;
  stat?: RegionVoteStat;
  isPinned: boolean;
  x: number;
  y: number;
};

type MapColors = {
  a: string;
  b: string;
  tie: string;
  neutral: string;
};

export interface CnAdminMapProps {
  statsByCode?: RegionVoteMap;
  defaultRegionLevel?: RegionLevel;
  className?: string;
  height?: number | string;
  initialCenter?: [number, number];
  initialZoom?: number;
  provinceZoomThreshold?: number;
  zoomThreshold?: number;
  bottomDockHeightPx?: number;
  toggleClearancePx?: number;
  colors?: Partial<MapColors>;
  theme?: MapTheme;
  showTooltip?: boolean;
  tooltipPinOnClick?: boolean;
  renderTooltipContent?: (context: MapTooltipContext) => ReactNode;
  onTooltipRegionChange?: (context: MapTooltipContext | null) => void;
  showNavigationControl?: boolean;
  showRegionLevelToggle?: boolean;
  regionLevelToggleAlign?: 'left' | 'right';
  fillMode?: MapFillMode;
  onRegionClick?: (region: { code: string; name: string; level: RegionLevel }) => void;
  onMapPointerDown?: () => void;
}

type HoveredRegion = {
  code: string;
  name: string;
  level: RegionLevel;
  x: number;
  y: number;
  stat?: RegionVoteStat;
};

type GeoJsonCodeNameFeature = {
  properties?: {
    code?: unknown;
    name?: unknown;
  };
};

type GeoJsonCodeNameCollection = {
  type?: string;
  features?: GeoJsonCodeNameFeature[];
};

const EMPTY_FEATURE_COLLECTION: FeatureCollection<Geometry> = {
  type: 'FeatureCollection',
  features: [],
};

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

const LOCKED_FILL_COLOR = 'rgba(122, 142, 165, 0.52)';

const LEVEL_OPTIONS: Array<{ value: RegionLevel; label: string; icon: typeof MapIcon }> = [
  { value: 'country', label: '국가(중국)', icon: MapPinnedIcon },
  { value: 'province', label: '성급(성/직할시)', icon: MapIcon },
  { value: 'prefecture', label: '지급시/구군', icon: Layers3Icon },
];

const LEVEL_LABEL: Record<RegionLevel, string> = {
  country: '국가(중국)',
  province: '성급(성/직할시)',
  prefecture: '지급시/구군',
};

function normalizeCode(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function getDefaultColors(theme: MapTheme): MapColors {
  return theme === 'dark' ? DARK_THEME_COLORS : DEFAULT_COLORS;
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

function normalizeFeatureCollection(json: unknown): FeatureCollection<Geometry> {
  const parsed = (json ?? {}) as FeatureCollection<Geometry>;
  if (parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
    return parsed;
  }
  return EMPTY_FEATURE_COLLECTION;
}

function extractCodes(collection: GeoJsonCodeNameCollection): Set<string> {
  const codes = new Set<string>();
  (collection.features ?? []).forEach((feature) => {
    const code = normalizeCode(feature.properties?.code);
    if (code) {
      codes.add(code);
    }
  });
  return codes;
}

function levelForZoom(zoom: number, provinceZoomThreshold: number, localZoomThreshold: number): RegionLevel {
  if (zoom >= localZoomThreshold) {
    return 'prefecture';
  }
  if (zoom >= provinceZoomThreshold) {
    return 'province';
  }
  return 'country';
}

const CN_COUNTRIES_GEO = normalizeFeatureCollection(cnCountryGeoRaw);
const CN_REGIONS_GEO = normalizeFeatureCollection(cnProvincesGeoRaw);
const CN_LOCAL_AUTHORITIES_GEO = normalizeFeatureCollection(cnPrefecturesGeoRaw);

const CN_COUNTRY_CODES = extractCodes(cnCountryGeoRaw as unknown as GeoJsonCodeNameCollection);
const CN_REGION_CODES = extractCodes(cnProvincesGeoRaw as unknown as GeoJsonCodeNameCollection);
const CN_LOCAL_CODES = extractCodes(cnPrefecturesGeoRaw as unknown as GeoJsonCodeNameCollection);

export default function CnAdminMap({
  statsByCode = {},
  defaultRegionLevel = 'province',
  className,
  height = 640,
  initialCenter,
  initialZoom,
  provinceZoomThreshold = 4.45,
  zoomThreshold = 5.35,
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
}: CnAdminMapProps) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const localLoadedRef = useRef(false);
  const countryCodesRef = useRef<Set<string>>(new Set(CN_COUNTRY_CODES));
  const regionCodesRef = useRef<Set<string>>(new Set(CN_REGION_CODES));
  const localCodesRef = useRef<Set<string>>(new Set(CN_LOCAL_CODES));
  const activeLevelRef = useRef<RegionLevel>(defaultRegionLevel);
  const selectedLevelRef = useRef<RegionLevel>(defaultRegionLevel);
  const statsRef = useRef<RegionVoteMap>(statsByCode);
  const colorsRef = useRef<MapColors>({ ...getDefaultColors(theme), ...colors });
  const hoverRef = useRef<{ source: RegionLevel; id: string | number } | null>(null);
  const levelSwitchRef = useRef<((nextLevel: RegionLevel) => void) | null>(null);
  const pinnedRegionRef = useRef<HoveredRegion | null>(null);
  const onRegionClickRef = useRef(onRegionClick);
  const onMapPointerDownRef = useRef(onMapPointerDown);
  const toggleBottomOffsetPx = Math.max(120, bottomDockHeightPx + toggleClearancePx);

  const [selectedLevel, setSelectedLevel] = useState<RegionLevel>(defaultRegionLevel);
  const [hovered, setHovered] = useState<HoveredRegion | null>(null);
  const [pinnedRegion, setPinnedRegion] = useState<HoveredRegion | null>(null);

  const activeTooltip = pinnedRegion ?? hovered;
  const isTooltipPinned = Boolean(pinnedRegion);

  const activeTooltipContext = useMemo<MapTooltipContext | null>(() => {
    if (!activeTooltip) {
      return null;
    }

    return {
      ...activeTooltip,
      isPinned: isTooltipPinned,
    };
  }, [activeTooltip, isTooltipPinned]);

  useEffect(() => {
    selectedLevelRef.current = selectedLevel;
  }, [selectedLevel]);

  useEffect(() => {
    pinnedRegionRef.current = pinnedRegion;
  }, [pinnedRegion]);

  useEffect(() => {
    onRegionClickRef.current = onRegionClick;
  }, [onRegionClick]);

  useEffect(() => {
    onMapPointerDownRef.current = onMapPointerDown;
  }, [onMapPointerDown]);

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
    onTooltipRegionChange?.(showTooltip ? activeTooltipContext : null);
  }, [activeTooltipContext, onTooltipRegionChange, showTooltip]);

  useEffect(() => {
    return () => {
      onTooltipRegionChange?.(null);
    };
  }, [onTooltipRegionChange]);

  useEffect(() => {
    statsRef.current = statsByCode;
    colorsRef.current = { ...getDefaultColors(theme), ...colors };

    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (map.getLayer('country-fills')) {
      map.setPaintProperty(
        'country-fills',
        'fill-color',
        buildFillExpression(statsByCode, colorsRef.current, fillMode, countryCodesRef.current),
      );
    }

    if (map.getLayer('province-fills')) {
      map.setPaintProperty(
        'province-fills',
        'fill-color',
        buildFillExpression(statsByCode, colorsRef.current, fillMode, regionCodesRef.current),
      );
    }

    if (map.getLayer('local-fills')) {
      map.setPaintProperty(
        'local-fills',
        'fill-color',
        buildFillExpression(statsByCode, colorsRef.current, fillMode, localCodesRef.current),
      );
    }
  }, [statsByCode, colors, fillMode, theme]);

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) {
      return;
    }

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
            sources: {},
            layers: [
              {
                id: 'bg',
                type: 'background',
                paint: { 'background-color': THEME_STYLES[theme].background },
              },
            ],
          };

    const map = new maplibregl.Map({
      container: mapNodeRef.current,
      style: mapStyle,
      center: initialCenter ?? [104.0, 35.8],
      zoom: initialZoom ?? 3.15,
      minZoom: 2.4,
      maxZoom: 9.8,
      attributionControl: false,
      dragRotate: false,
      touchPitch: false,
    });

    if (showNavigationControl) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    }

    mapRef.current = map;

    map.on('mousedown', () => {
      onMapPointerDownRef.current?.();
    });

    map.on('touchstart', () => {
      onMapPointerDownRef.current?.();
    });

    const clearHover = () => {
      const prev = hoverRef.current;
      if (!prev) {
        return;
      }
      map.setFeatureState({ source: prev.source, id: prev.id }, { hover: false });
      hoverRef.current = null;
    };

    const setLayerVisibility = (layerId: string, visible: boolean) => {
      if (!map.getLayer(layerId)) {
        return;
      }
      map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    };

    const syncLayerVisibility = (nextLevel: RegionLevel) => {
      if (nextLevel === 'prefecture' && !localLoadedRef.current) {
        const localSource = map.getSource('prefecture') as GeoJSONSource | undefined;
        localSource?.setData(CN_LOCAL_AUTHORITIES_GEO);
        if (map.getLayer('local-fills')) {
          map.setPaintProperty(
            'local-fills',
            'fill-color',
            buildFillExpression(statsRef.current, colorsRef.current, fillMode, localCodesRef.current),
          );
        }
        localLoadedRef.current = true;
      }

      setLayerVisibility('country-fills', nextLevel === 'country');
      setLayerVisibility('country-borders', nextLevel === 'country');
      setLayerVisibility('province-fills', nextLevel === 'province');
      setLayerVisibility('province-borders', nextLevel === 'province');
      setLayerVisibility('local-fills', nextLevel === 'prefecture');
      setLayerVisibility('local-borders', nextLevel === 'prefecture');

      activeLevelRef.current = nextLevel;
      selectedLevelRef.current = nextLevel;
      setSelectedLevel(nextLevel);

      clearHover();
      setHovered(null);
      setPinnedRegion(null);
    };

    const registerHoverAndClick = (layerId: string, source: RegionLevel) => {
      map.on('mousemove', layerId, (event) => {
        if (source !== activeLevelRef.current) {
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
        if (!prev || prev.source !== source || prev.id !== id) {
          clearHover();
          map.setFeatureState({ source, id }, { hover: true });
          hoverRef.current = { source, id };
        }

        map.getCanvas().style.cursor = 'pointer';
        if (showTooltip) {
          setHovered({
            code,
            name: name || code,
            level: source,
            x: event.point.x + 14,
            y: event.point.y + 14,
            stat: statsRef.current[code],
          });
        }
      });

      map.on('mouseleave', layerId, () => {
        if (source !== activeLevelRef.current) {
          return;
        }

        clearHover();
        map.getCanvas().style.cursor = '';
        if (showTooltip) {
          setHovered(null);
        }
      });

      map.on('click', layerId, (event) => {
        if (source !== activeLevelRef.current) {
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
            level: source,
            x: event.point.x + 14,
            y: event.point.y + 14,
            stat: statsRef.current[code],
          });
        }

        onRegionClickRef.current?.({ code, name, level: source });
      });
    };

    map.on('load', () => {
      map.addSource('country', {
        type: 'geojson',
        data: CN_COUNTRIES_GEO,
        promoteId: 'code',
      });

      map.addSource('province', {
        type: 'geojson',
        data: CN_REGIONS_GEO,
        promoteId: 'code',
      });

      map.addSource('prefecture', {
        type: 'geojson',
        data: EMPTY_FEATURE_COLLECTION,
        promoteId: 'code',
      });

      const themeStyle = THEME_STYLES[theme];

      map.addLayer({
        id: 'country-fills',
        type: 'fill',
        source: 'country',
        paint: {
          'fill-color': buildFillExpression(statsRef.current, colorsRef.current, fillMode, countryCodesRef.current),
          'fill-opacity': buildFillOpacityExpression(0.74),
        },
      });

      map.addLayer({
        id: 'country-borders',
        type: 'line',
        source: 'country',
        paint: {
          'line-color': themeStyle.majorBorder,
          'line-width': theme === 'dark' ? 1.25 : 1.1,
          'line-opacity': 1,
        },
      });

      map.addLayer({
        id: 'province-fills',
        type: 'fill',
        source: 'province',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': buildFillExpression(statsRef.current, colorsRef.current, fillMode, regionCodesRef.current),
          'fill-opacity': buildFillOpacityExpression(0.7),
        },
      });

      map.addLayer({
        id: 'province-borders',
        type: 'line',
        source: 'province',
        layout: { visibility: 'none' },
        paint: {
          'line-color': themeStyle.majorBorder,
          'line-width': theme === 'dark' ? 1.0 : 0.95,
          'line-opacity': 1,
        },
      });

      map.addLayer({
        id: 'local-fills',
        type: 'fill',
        source: 'prefecture',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': colorsRef.current.neutral,
          'fill-opacity': buildFillOpacityExpression(0.68),
        },
      });

      map.addLayer({
        id: 'local-borders',
        type: 'line',
        source: 'prefecture',
        layout: { visibility: 'none' },
        paint: {
          'line-color': themeStyle.minorBorder,
          'line-width': theme === 'dark' ? 0.92 : 0.78,
          'line-opacity': 1,
        },
      });

      registerHoverAndClick('country-fills', 'country');
      registerHoverAndClick('province-fills', 'province');
      registerHoverAndClick('local-fills', 'prefecture');

      syncLayerVisibility(defaultRegionLevel);
    });

    levelSwitchRef.current = (nextLevel: RegionLevel) => {
      syncLayerVisibility(nextLevel);
    };

    map.on('zoomend', () => {
      const nextLevel = levelForZoom(map.getZoom(), provinceZoomThreshold, zoomThreshold);
      if (nextLevel === activeLevelRef.current) {
        return;
      }
      levelSwitchRef.current?.(nextLevel);
    });

    return () => {
      setHovered(null);
      setPinnedRegion(null);
      pinnedRegionRef.current = null;
      levelSwitchRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [
    defaultRegionLevel,
    fillMode,
    initialCenter,
    initialZoom,
    provinceZoomThreshold,
    showNavigationControl,
    showTooltip,
    theme,
    tooltipPinOnClick,
    zoomThreshold,
  ]);

  const handleSelectLevel = (level: RegionLevel) => {
    if (!mapRef.current) {
      return;
    }

    levelSwitchRef.current?.(level);
  };

  return (
    <div
      className={`relative z-0 overflow-hidden rounded-2xl border ${THEME_STYLES[theme].wrapperClass} ${className ?? ''}`}
    >
      <div ref={mapNodeRef} className="relative z-0" style={{ width: '100%', height }} />

      {showRegionLevelToggle ? (
        <div
          className={`pointer-events-auto absolute z-10 inline-flex items-center overflow-hidden rounded-2xl border border-white/24 bg-[rgba(10,16,24,0.7)] p-1 shadow-[0_10px_24px_rgba(0,0,0,0.32)] backdrop-blur-md ${
            regionLevelToggleAlign === 'right' ? 'right-3' : 'left-3'
          }`}
          style={{ bottom: `${toggleBottomOffsetPx}px` }}
          role="radiogroup"
          aria-label="중국 행정 레벨 토글"
        >
          {LEVEL_OPTIONS.map((option) => {
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
                  active ? 'border border-white/30 bg-white/14 text-white' : 'text-white/62 hover:text-white/88'
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
          className={`absolute z-10 shadow-lg ${isTooltipPinned ? 'pointer-events-auto' : 'pointer-events-none'} ${
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
                {LEVEL_LABEL[activeTooltipContext.level]} · {activeTooltipContext.code}
              </div>
              {activeTooltipContext.stat ? (
                <div className={`mt-1 text-[11px] ${THEME_STYLES[theme].tooltipSubClass}`}>
                  {typeof activeTooltipContext.stat.countA === 'number' &&
                  typeof activeTooltipContext.stat.countB === 'number' ? (
                    <>
                      A {activeTooltipContext.stat.countA} · B {activeTooltipContext.stat.countB} · 합계{' '}
                      {activeTooltipContext.stat.total ??
                        (activeTooltipContext.stat.countA ?? 0) + (activeTooltipContext.stat.countB ?? 0)}
                    </>
                  ) : (
                    <>
                      격차 {activeTooltipContext.stat.gapPercent ?? 0}%p · 총{' '}
                      {(activeTooltipContext.stat.total ?? 0).toLocaleString()}표
                    </>
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
