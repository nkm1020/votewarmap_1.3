'use client';

import { useEffect, useRef, useState } from 'react';
import type { FeatureCollection, Geometry } from 'geojson';
import maplibregl, { type ExpressionSpecification, type GeoJSONSource } from 'maplibre-gl';
import { Layers3Icon, MapIcon } from 'lucide-react';
import { motion } from 'framer-motion';

type RegionLevel = 'sido' | 'sigungu';

export type RegionWinner = 'A' | 'B' | 'TIE';

export type RegionVoteStat = {
  winner?: RegionWinner;
  total?: number;
  countA?: number;
  countB?: number;
};

export type RegionVoteMap = Record<string, RegionVoteStat>;

type HoveredRegion = {
  code: string;
  name: string;
  level: RegionLevel;
  x: number;
  y: number;
  stat?: RegionVoteStat;
};

type MapColors = {
  a: string;
  b: string;
  tie: string;
  neutral: string;
};

type MapTheme = 'light' | 'dark';

export interface KoreaAdminMapProps {
  statsByCode?: RegionVoteMap;
  className?: string;
  height?: number | string;
  initialCenter?: [number, number];
  initialZoom?: number;
  zoomThreshold?: number;
  colors?: Partial<MapColors>;
  theme?: MapTheme;
  showTooltip?: boolean;
  showNavigationControl?: boolean;
  showRegionLevelToggle?: boolean;
  onRegionClick?: (region: { code: string; name: string; level: RegionLevel }) => void;
  onMapZoomDirectionChange?: (payload: { zoom: number; direction: 'in' | 'out' }) => void;
}

const DEFAULT_COLORS: MapColors = {
  a: 'rgba(233, 73, 73, 0.72)',
  b: 'rgba(36, 117, 255, 0.72)',
  tie: 'rgba(255, 187, 0, 0.72)',
  neutral: 'rgba(115, 115, 115, 0.35)',
};

const DARK_THEME_COLORS: MapColors = {
  a: 'rgba(255, 121, 39, 0.74)',
  b: 'rgba(72, 145, 255, 0.72)',
  tie: 'rgba(255, 188, 52, 0.72)',
  neutral: 'rgba(72, 60, 52, 0.5)',
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
    background: '#17120f',
    majorBorder: 'rgba(255,255,255,0.24)',
    minorBorder: 'rgba(255,255,255,0.16)',
    wrapperClass: 'border-white/10 bg-black/15',
    tooltipClass: 'border border-white/10 bg-[rgba(24,20,16,0.88)] text-white backdrop-blur-md',
    tooltipSubClass: 'text-white/70',
  },
} as const;

const EMPTY_FEATURE_COLLECTION: FeatureCollection<Geometry> = {
  type: 'FeatureCollection',
  features: [],
};
const REGION_NAME_OVERRIDES: Record<string, string> = {
  '23030': '미추홀구',
};

const LEVEL_TRANSITION_MS = 420;
const AUTO_BLEND_MARGIN = 0.55;
const REGION_LEVEL_OPTIONS: Array<{ value: RegionLevel; label: string; icon: typeof MapIcon }> = [
  { value: 'sido', label: '시도', icon: MapIcon },
  { value: 'sigungu', label: '시군구', icon: Layers3Icon },
];

function getDefaultColors(theme: MapTheme): MapColors {
  return theme === 'dark' ? DARK_THEME_COLORS : DEFAULT_COLORS;
}

function buildFillExpression(statsByCode: RegionVoteMap, colors: MapColors): ExpressionSpecification {
  const entries: string[] = [];

  Object.entries(statsByCode).forEach(([code, stat]) => {
    const winner = resolveWinner(stat);
    const fill = winner === 'A' ? colors.a : winner === 'B' ? colors.b : colors.tie;
    entries.push(code, fill);
  });

  const featureCode: ExpressionSpecification = ['to-string', ['coalesce', ['get', 'code'], ['id']]];
  return ['match', featureCode, ...entries, colors.neutral] as ExpressionSpecification;
}

function normalizeCode(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
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

function resolveRegionDisplayName(code: string, fallbackName: string): string {
  return REGION_NAME_OVERRIDES[code] ?? fallbackName;
}

function buildFillOpacityExpression(baseOpacity: number): ExpressionSpecification {
  const safeBase = Math.max(0, Math.min(1, baseOpacity));
  const hoverOpacity = Math.max(safeBase, Math.min(1, safeBase + 0.16));
  return ['case', ['boolean', ['feature-state', 'hover'], false], hoverOpacity, safeBase] as ExpressionSpecification;
}

export default function KoreaAdminMap({
  statsByCode = {},
  className,
  height = 640,
  initialCenter,
  initialZoom,
  zoomThreshold = 8,
  colors,
  theme = 'light',
  showTooltip = true,
  showNavigationControl = true,
  showRegionLevelToggle = false,
  onRegionClick,
  onMapZoomDirectionChange,
}: KoreaAdminMapProps) {
  const defaultCenter: [number, number] = initialCenter ?? [127.8, 36.2];
  const defaultZoom = initialZoom ?? 6.3;
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const sigunguLoadedRef = useRef(false);
  const sigunguCodesRef = useRef<string[]>([]);
  const activeLevelRef = useRef<RegionLevel>('sido');
  const hoverRef = useRef<{ source: RegionLevel; id: string | number } | null>(null);
  const statsRef = useRef<RegionVoteMap>(statsByCode);
  const colorsRef = useRef<MapColors>({ ...getDefaultColors(theme), ...colors });
  const onRegionClickRef = useRef(onRegionClick);
  const onMapZoomDirectionChangeRef = useRef(onMapZoomDirectionChange);
  const switchTimeoutRef = useRef<number | null>(null);
  const requestLevelSwitchRef = useRef<((level?: RegionLevel) => void) | null>(null);
  const suppressAutoLevelSyncRef = useRef(false);
  const selectedLevelRef = useRef<RegionLevel>('sido');
  const [hovered, setHovered] = useState<HoveredRegion | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<RegionLevel>('sido');

  useEffect(() => {
    onRegionClickRef.current = onRegionClick;
  }, [onRegionClick]);

  useEffect(() => {
    onMapZoomDirectionChangeRef.current = onMapZoomDirectionChange;
  }, [onMapZoomDirectionChange]);

  useEffect(() => {
    selectedLevelRef.current = selectedLevel;
  }, [selectedLevel]);

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: mapNodeRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: 'bg',
            type: 'background',
            paint: { 'background-color': THEME_STYLES[theme].background },
          },
        ],
      },
      center: initialCenter ?? [127.8, 36.2],
      zoom: initialZoom ?? 6.3,
      minZoom: 5.5,
      maxZoom: 10.5,
      attributionControl: false,
      dragRotate: false,
      touchPitch: false,
    });

    if (showNavigationControl) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    }
    mapRef.current = map;

    const clearHover = () => {
      const prev = hoverRef.current;
      if (prev) {
        map.setFeatureState({ source: prev.source, id: prev.id }, { hover: false });
        hoverRef.current = null;
      }
    };

    const themeStyle = THEME_STYLES[theme];
    const majorOpacity = theme === 'dark' ? 0.8 : 0.74;
    const minorOpacity = theme === 'dark' ? 0.76 : 0.7;

    const setLayerVisibility = (layerId: string, visible: boolean) => {
      if (!map.getLayer(layerId)) {
        return;
      }
      map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    };

    const syncInteractiveLayerOrder = (activeLevel: RegionLevel) => {
      if (activeLevel === 'sigungu') {
        if (map.getLayer('sigungu-fills')) {
          map.moveLayer('sigungu-fills');
        }
        if (map.getLayer('sigungu-borders')) {
          map.moveLayer('sigungu-borders');
        }
        return;
      }

      if (map.getLayer('sido-fills')) {
        map.moveLayer('sido-fills');
      }
      if (map.getLayer('sido-borders')) {
        map.moveLayer('sido-borders');
      }
    };

    const applyLayerOpacity = (sidoOpacity: number, sigunguOpacity: number) => {
      if (map.getLayer('sido-fills')) {
        map.setPaintProperty('sido-fills', 'fill-opacity', buildFillOpacityExpression(sidoOpacity));
      }
      if (map.getLayer('sigungu-fills')) {
        map.setPaintProperty('sigungu-fills', 'fill-opacity', buildFillOpacityExpression(sigunguOpacity));
      }
      if (map.getLayer('sido-borders')) {
        map.setPaintProperty('sido-borders', 'line-opacity', Math.max(0, Math.min(1, sidoOpacity)));
      }
      if (map.getLayer('sigungu-borders')) {
        map.setPaintProperty('sigungu-borders', 'line-opacity', Math.max(0, Math.min(1, sigunguOpacity)));
      }
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
        const name = resolveRegionDisplayName(
          code,
          normalizeCode(feature.properties?.name),
        );
        const id = feature.id ?? code;
        const stat = statsRef.current[code];

        if (!code || !id) {
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
            name,
            level: source,
            x: event.point.x + 14,
            y: event.point.y + 14,
            stat,
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
        const name = resolveRegionDisplayName(
          code,
          normalizeCode(feature.properties?.name),
        );
        if (!code) {
          return;
        }

        onRegionClickRef.current?.({ code, name, level: source });
      });
    };

    const ensureSigunguLoaded = async () => {
      if (sigunguLoadedRef.current) {
        return;
      }

      const sigungu = await fetch('/data/skorea_municipalities_geo_simple.json').then((res) => res.json());
      const source = map.getSource('sigungu') as GeoJSONSource | undefined;
      source?.setData(sigungu);

      sigunguCodesRef.current = (sigungu.features ?? [])
        .map((feature: { properties?: { code?: unknown } }) => normalizeCode(feature?.properties?.code))
        .filter(Boolean);

      const resolvedFill = buildFillExpression(statsRef.current, colorsRef.current);
      if (map.getLayer('sigungu-fills')) {
        map.setPaintProperty('sigungu-fills', 'fill-color', resolvedFill);
      }

      sigunguLoadedRef.current = true;
    };

    const updateLevelVisibility = async (forcedLevel?: RegionLevel) => {
      const nextLevel: RegionLevel = forcedLevel ?? (map.getZoom() >= zoomThreshold ? 'sigungu' : 'sido');
      if (nextLevel === 'sigungu') {
        await ensureSigunguLoaded();
      }

      if (nextLevel === activeLevelRef.current) {
        const showSigungu = nextLevel === 'sigungu';
        if (switchTimeoutRef.current) {
          window.clearTimeout(switchTimeoutRef.current);
          switchTimeoutRef.current = null;
        }
        applyLayerOpacity(showSigungu ? 0 : majorOpacity, showSigungu ? minorOpacity : 0);
        setLayerVisibility('sido-fills', !showSigungu);
        setLayerVisibility('sido-borders', !showSigungu);
        setLayerVisibility('sigungu-fills', showSigungu);
        setLayerVisibility('sigungu-borders', showSigungu);
        syncInteractiveLayerOrder(nextLevel);
        setSelectedLevel(nextLevel);
        return;
      }

      clearHover();
      setHovered(null);

      if (switchTimeoutRef.current) {
        window.clearTimeout(switchTimeoutRef.current);
        switchTimeoutRef.current = null;
      }

      setLayerVisibility('sido-fills', true);
      setLayerVisibility('sido-borders', true);
      setLayerVisibility('sigungu-fills', true);
      setLayerVisibility('sigungu-borders', true);

      const showSigungu = nextLevel === 'sigungu';
      applyLayerOpacity(showSigungu ? 0 : majorOpacity, showSigungu ? minorOpacity : 0);
      syncInteractiveLayerOrder(nextLevel);

      switchTimeoutRef.current = window.setTimeout(() => {
        setLayerVisibility('sido-fills', !showSigungu);
        setLayerVisibility('sido-borders', !showSigungu);
        setLayerVisibility('sigungu-fills', showSigungu);
        setLayerVisibility('sigungu-borders', showSigungu);
      }, LEVEL_TRANSITION_MS + 24);

      activeLevelRef.current = nextLevel;
      setSelectedLevel(nextLevel);
    };

    const applyAutoBlendByZoom = async (zoom: number) => {
      const blendStart = zoomThreshold - AUTO_BLEND_MARGIN;
      const blendEnd = zoomThreshold + AUTO_BLEND_MARGIN;

      if (zoom <= blendStart) {
        return;
      }
      if (zoom >= blendEnd) {
        return;
      }

      await ensureSigunguLoaded();

      if (switchTimeoutRef.current) {
        window.clearTimeout(switchTimeoutRef.current);
        switchTimeoutRef.current = null;
      }

      const ratio = (zoom - blendStart) / (blendEnd - blendStart);
      const clampedRatio = Math.max(0, Math.min(1, ratio));
      const nextLevel: RegionLevel = clampedRatio >= 0.5 ? 'sigungu' : 'sido';

      setLayerVisibility('sido-fills', true);
      setLayerVisibility('sido-borders', true);
      setLayerVisibility('sigungu-fills', true);
      setLayerVisibility('sigungu-borders', true);
      applyLayerOpacity(majorOpacity * (1 - clampedRatio), minorOpacity * clampedRatio);
      syncInteractiveLayerOrder(nextLevel);
      activeLevelRef.current = nextLevel;
      if (selectedLevelRef.current !== nextLevel) {
        setSelectedLevel(nextLevel);
      }
    };

    requestLevelSwitchRef.current = (level?: RegionLevel) => {
      void updateLevelVisibility(level);
    };

    map.on('load', () => {
      const initialFill = buildFillExpression(statsRef.current, colorsRef.current);

      map.addSource('sido', {
        type: 'geojson',
        data: '/data/skorea_provinces_geo_simple.json',
        promoteId: 'code',
      });

      map.addSource('sigungu', {
        type: 'geojson',
        data: EMPTY_FEATURE_COLLECTION,
        promoteId: 'code',
      });

      map.addLayer({
        id: 'sido-fills',
        type: 'fill',
        source: 'sido',
        paint: {
          'fill-color': initialFill,
          'fill-opacity': buildFillOpacityExpression(majorOpacity),
          'fill-opacity-transition': {
            duration: LEVEL_TRANSITION_MS,
            delay: 0,
          },
        },
      });

      map.addLayer({
        id: 'sido-borders',
        type: 'line',
        source: 'sido',
        paint: {
          'line-color': themeStyle.majorBorder,
          'line-width': 1.1,
          'line-opacity': 1,
          'line-opacity-transition': {
            duration: LEVEL_TRANSITION_MS,
            delay: 0,
          },
        },
      });

      map.addLayer({
        id: 'sigungu-fills',
        type: 'fill',
        source: 'sigungu',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': initialFill,
          'fill-opacity': buildFillOpacityExpression(0),
          'fill-opacity-transition': {
            duration: LEVEL_TRANSITION_MS,
            delay: 0,
          },
        },
      });

      map.addLayer({
        id: 'sigungu-borders',
        type: 'line',
        source: 'sigungu',
        layout: { visibility: 'none' },
        paint: {
          'line-color': themeStyle.minorBorder,
          'line-width': 0.8,
          'line-opacity': 0,
          'line-opacity-transition': {
            duration: LEVEL_TRANSITION_MS,
            delay: 0,
          },
        },
      });

      registerHoverAndClick('sido-fills', 'sido');
      registerHoverAndClick('sigungu-fills', 'sigungu');
      void ensureSigunguLoaded();
      requestLevelSwitchRef.current?.();
    });

    let lastZoom = map.getZoom();

    map.on('zoom', () => {
      if (suppressAutoLevelSyncRef.current) {
        return;
      }
      void applyAutoBlendByZoom(map.getZoom());
    });

    map.on('zoomend', () => {
      const currentZoom = map.getZoom();
      const previousZoom = lastZoom;
      if (currentZoom > previousZoom) {
        onMapZoomDirectionChangeRef.current?.({ zoom: currentZoom, direction: 'in' });
      } else if (currentZoom < previousZoom) {
        onMapZoomDirectionChangeRef.current?.({ zoom: currentZoom, direction: 'out' });
      }
      lastZoom = currentZoom;
      if (suppressAutoLevelSyncRef.current) {
        return;
      }
      requestLevelSwitchRef.current?.();
    });

    return () => {
      setHovered(null);
      if (switchTimeoutRef.current) {
        window.clearTimeout(switchTimeoutRef.current);
        switchTimeoutRef.current = null;
      }
      requestLevelSwitchRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [zoomThreshold, theme, showNavigationControl, showTooltip, initialCenter, initialZoom]);

  useEffect(() => {
    statsRef.current = statsByCode;
    colorsRef.current = { ...getDefaultColors(theme), ...colors };

    const map = mapRef.current;
    if (!map) {
      return;
    }

    const fillExpression = buildFillExpression(statsByCode, colorsRef.current);
    if (map.getLayer('sido-fills')) {
      map.setPaintProperty('sido-fills', 'fill-color', fillExpression);
    }
    if (map.getLayer('sigungu-fills')) {
      map.setPaintProperty('sigungu-fills', 'fill-color', fillExpression);
    }
  }, [statsByCode, colors, theme]);

  const handleSelectLevel = (nextLevel: RegionLevel) => {
    setSelectedLevel(nextLevel);
    const map = mapRef.current;
    if (!map) {
      requestLevelSwitchRef.current?.(nextLevel);
      return;
    }

    const targetZoom = defaultZoom;
    const currentCenter = map.getCenter();
    const centerDelta = Math.abs(currentCenter.lng - defaultCenter[0]) + Math.abs(currentCenter.lat - defaultCenter[1]);
    const zoomDelta = Math.abs(map.getZoom() - targetZoom);
    const hasMeaningfulMove = centerDelta > 0.0005 || zoomDelta > 0.02;

    if (!hasMeaningfulMove) {
      requestLevelSwitchRef.current?.(nextLevel);
      return;
    }

    suppressAutoLevelSyncRef.current = true;
    map.once('moveend', () => {
      requestLevelSwitchRef.current?.(nextLevel);
      suppressAutoLevelSyncRef.current = false;
    });
    map.easeTo({
      center: defaultCenter,
      zoom: targetZoom,
      duration: 430,
      essential: true,
    });
  };

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border ${THEME_STYLES[theme].wrapperClass} ${className ?? ''}`}
    >
      <div ref={mapNodeRef} style={{ width: '100%', height }} />
      {showRegionLevelToggle ? (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28 }}
          className="pointer-events-auto absolute right-3 top-1/2 z-20 inline-flex -translate-y-1/2 items-center overflow-hidden rounded-md border border-white/18 bg-[rgba(14,14,18,0.68)] p-0.5 shadow-[0_8px_24px_rgba(0,0,0,0.32)] backdrop-blur-md"
          role="radiogroup"
          aria-label="행정구역 레벨 토글"
        >
          {REGION_LEVEL_OPTIONS.map((option) => {
            const active = selectedLevel === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`${option.label} 보기`}
                onClick={() => handleSelectLevel(option.value)}
                className={`relative inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-[11px] font-semibold transition ${
                  active ? 'text-white' : 'text-white/62 hover:text-white/88'
                }`}
              >
                {active ? (
                  <motion.span
                    layoutId="region-level-option"
                    transition={{ type: 'spring', bounce: 0.16, duration: 0.52 }}
                    className="absolute inset-0 rounded-md border border-white/28 bg-white/10"
                  />
                ) : null}
                <option.icon className="relative z-10 h-3.5 w-3.5" />
                <span className="relative z-10">{option.label}</span>
              </button>
            );
          })}
        </motion.div>
      ) : null}
      {showTooltip && hovered ? (
        <div
          className={`pointer-events-none absolute z-10 rounded-md px-2.5 py-1.5 text-xs font-medium shadow-lg ${THEME_STYLES[theme].tooltipClass}`}
          style={{ left: hovered.x, top: hovered.y }}
        >
          <div>{hovered.name || hovered.code}</div>
          <div className={`text-[11px] ${THEME_STYLES[theme].tooltipSubClass}`}>
            {hovered.level === 'sido' ? '시/도' : '시/군/구'} · {hovered.code}
          </div>
          {hovered.stat ? (
            <div className={`mt-1 text-[11px] ${THEME_STYLES[theme].tooltipSubClass}`}>
              A {hovered.stat.countA ?? 0} · B {hovered.stat.countB ?? 0} · 합계{' '}
              {hovered.stat.total ?? (hovered.stat.countA ?? 0) + (hovered.stat.countB ?? 0)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
