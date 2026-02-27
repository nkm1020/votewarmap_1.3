'use client';

import dynamic from 'next/dynamic';
import { useCallback, useMemo, useState } from 'react';
import type { MapTooltipContext, RegionVoteMap, RegionVoteStat } from '@/components/UkAdminMap';
import ukCountriesGeo from '@/public/data/uk_countries_geo_sample.json';
import ukRegionsGeo from '@/public/data/uk_regions_geo_sample.json';
import ukLocalAuthoritiesGeo from '@/public/data/uk_local_authorities_geo_sample.json';

const UkAdminMap = dynamic(() => import('@/components/UkAdminMap'), { ssr: false });

const TOPICS = [
  { id: 'transport', label: '교통 정책' },
  { id: 'housing', label: '주거 정책' },
  { id: 'energy', label: '에너지 정책' },
] as const;

type TopicId = (typeof TOPICS)[number]['id'];

type RegionSelection = {
  code: string;
  name: string;
  level: MapTooltipContext['level'];
};

type CountryFeature = {
  properties?: {
    code?: string;
  };
};

type LocalFeature = {
  properties?: {
    code?: string;
    country_code?: string;
  };
};

type RegionFeature = {
  properties?: {
    code?: string;
    country_code?: string;
  };
};

const TOPIC_BIAS: Record<TopicId, { a: string[]; b: string[] }> = {
  transport: {
    a: ['ENG', 'SCT'],
    b: ['WLS', 'NIR'],
  },
  housing: {
    a: ['ENG', 'WLS'],
    b: ['SCT', 'NIR'],
  },
  energy: {
    a: ['SCT', 'NIR'],
    b: ['ENG', 'WLS'],
  },
};

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }
  return Math.abs(hash >>> 0);
}

function computeVoteStat(regionCode: string, topic: TopicId, parentCountryCode: string): RegionVoteStat {
  const topicSeed = TOPICS.findIndex((item) => item.id === topic) + 1;
  const codeHash = hashString(regionCode);
  let countA = 130 + ((codeHash + topicSeed * 37) % 760);
  let countB = 130 + ((codeHash + topicSeed * 53) % 760);

  const bias = TOPIC_BIAS[topic];
  if (bias.a.includes(parentCountryCode)) {
    countA += 120;
    countB = Math.max(70, countB - 45);
  }

  if (bias.b.includes(parentCountryCode)) {
    countB += 120;
    countA = Math.max(70, countA - 45);
  }

  if ((codeHash + topicSeed) % 17 === 0) {
    countB = countA;
  }

  const total = countA + countB;
  const winner = countA > countB ? 'A' : countB > countA ? 'B' : 'TIE';
  const aPercent = total > 0 ? Math.round((countA / total) * 100) : 0;
  const bPercent = total > 0 ? Math.max(0, 100 - aPercent) : 0;

  return {
    countA,
    countB,
    total,
    winner,
    gapPercent: Math.abs(aPercent - bPercent),
  };
}

function resolveCountryCode(code: string, countryCode: string): string {
  if (countryCode) {
    return countryCode;
  }
  const inferred = code.split('-')[0] ?? '';
  return inferred || 'ENG';
}

function levelLabel(level: MapTooltipContext['level']): string {
  if (level === 'country') {
    return '구성국';
  }
  if (level === 'region') {
    return '권역';
  }
  return '지자체(Local Authority)';
}

export default function UkMapSection() {
  const [activeTopic, setActiveTopic] = useState<TopicId>('transport');
  const [selectedRegion, setSelectedRegion] = useState<RegionSelection | null>(null);

  const countryCodes = useMemo(
    () =>
      ((ukCountriesGeo.features ?? []) as CountryFeature[])
        .map((feature) => String(feature.properties?.code ?? '').trim())
        .filter(Boolean),
    [],
  );

  const localAuthorities = useMemo(
    () =>
      ((ukLocalAuthoritiesGeo.features ?? []) as LocalFeature[])
        .map((feature) => ({
          code: String(feature.properties?.code ?? '').trim(),
          countryCode: resolveCountryCode(
            String(feature.properties?.code ?? '').trim(),
            String(feature.properties?.country_code ?? '').trim(),
          ),
        }))
        .filter((item) => Boolean(item.code) && Boolean(item.countryCode)),
    [],
  );

  const regions = useMemo(
    () =>
      ((ukRegionsGeo.features ?? []) as RegionFeature[])
        .map((feature) => ({
          code: String(feature.properties?.code ?? '').trim(),
          countryCode: resolveCountryCode(
            String(feature.properties?.code ?? '').trim(),
            String(feature.properties?.country_code ?? '').trim(),
          ),
        }))
        .filter((item) => Boolean(item.code) && Boolean(item.countryCode)),
    [],
  );

  const statsByCode = useMemo(() => {
    const map: RegionVoteMap = {};

    countryCodes.forEach((countryCode) => {
      map[countryCode] = computeVoteStat(countryCode, activeTopic, countryCode);
    });

    regions.forEach((region) => {
      map[region.code] = computeVoteStat(region.code, activeTopic, region.countryCode);
    });

    localAuthorities.forEach((local) => {
      map[local.code] = computeVoteStat(local.code, activeTopic, local.countryCode);
    });

    return map;
  }, [activeTopic, countryCodes, localAuthorities, regions]);

  const selectedStat = useMemo(() => {
    if (!selectedRegion) {
      return null;
    }

    return statsByCode[selectedRegion.code] ?? null;
  }, [selectedRegion, statsByCode]);

  const renderTooltipContent = useCallback(
    (context: MapTooltipContext) => {
      const stat = context.stat ?? null;
      const countA = stat?.countA ?? 0;
      const countB = stat?.countB ?? 0;
      const total = stat?.total ?? countA + countB;

      return (
        <div className="w-[min(320px,calc(100vw-40px))] rounded-xl border border-slate-700 bg-slate-900/95 px-3 py-2.5 text-slate-100 shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-semibold">{context.name || context.code}</p>
            <span className="rounded-full border border-slate-600 bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200">
              {levelLabel(context.level)}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-300">
            {TOPICS.find((topic) => topic.id === activeTopic)?.label ?? '주제'} · A {countA.toLocaleString()} / B{' '}
            {countB.toLocaleString()} / 합계 {total.toLocaleString()}
          </p>
        </div>
      );
    },
    [activeTopic],
  );

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-10 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">영국 행정구역 테스트 지도</h1>
        <p className="text-sm text-slate-600 sm:text-base">
          UK 샘플 경계 데이터로 구성국/권역/지자체(Local Authority) 전환과 색칠 로직을 검증합니다.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {TOPICS.map((topic) => {
          const active = topic.id === activeTopic;
          return (
            <button
              key={topic.id}
              type="button"
              onClick={() => setActiveTopic(topic.id)}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                active
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-slate-500 hover:text-slate-900'
              }`}
            >
              {topic.label}
            </button>
          );
        })}
      </div>

      <UkAdminMap
        className="shadow-sm"
        height={620}
        theme="light"
        fillMode="winner"
        showRegionLevelToggle
        defaultRegionLevel="country"
        initialCenter={[-2.8, 54.7]}
        initialZoom={4.95}
        zoomThreshold={6.6}
        statsByCode={statsByCode}
        renderTooltipContent={renderTooltipContent}
        onRegionClick={(region) => setSelectedRegion(region)}
      />

      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        {selectedRegion ? (
          <>
            <p className="text-sm font-semibold text-slate-900">
              선택 지역: {selectedRegion.name || selectedRegion.code} ({levelLabel(selectedRegion.level)})
            </p>
            {selectedStat ? (
              <p className="mt-1 text-sm text-slate-600">
                A {selectedStat.countA?.toLocaleString() ?? 0} · B {selectedStat.countB?.toLocaleString() ?? 0} · 총{' '}
                {selectedStat.total?.toLocaleString() ?? 0}표 · 우세 {selectedStat.winner ?? 'TIE'}
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-500">해당 지역 통계가 없습니다.</p>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-600">지도의 지역을 클릭하면 상세 통계를 볼 수 있습니다.</p>
        )}
      </div>
    </section>
  );
}
