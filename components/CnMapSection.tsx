'use client';

import dynamic from 'next/dynamic';
import { useCallback, useMemo, useState } from 'react';
import type { MapTooltipContext, RegionVoteMap, RegionVoteStat } from '@/components/CnAdminMap';
import cnCountryGeo from '@/public/data/cn_country_geo_sample.json';
import cnProvincesGeo from '@/public/data/cn_provinces_geo_sample.json';
import cnPrefecturesGeo from '@/public/data/cn_prefectures_geo_sample.json';

const CnAdminMap = dynamic(() => import('@/components/CnAdminMap'), { ssr: false });

const TOPICS = [
  { id: 'economy', label: '경제 정책' },
  { id: 'housing', label: '주거 정책' },
  { id: 'industry', label: '산업 정책' },
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

type ProvinceFeature = {
  properties?: {
    code?: string;
    country_code?: string;
    region_code?: string;
  };
};

type PrefectureFeature = {
  properties?: {
    code?: string;
    country_code?: string;
    province_code?: string;
    region_code?: string;
    admin_level?: string;
  };
};

const TOPIC_BIAS: Record<TopicId, { a: string[]; b: string[] }> = {
  economy: {
    a: ['CN-EAST', 'CN-SOUTH'],
    b: ['CN-NORTHEAST', 'CN-NORTHWEST'],
  },
  housing: {
    a: ['CN-NORTH', 'CN-CENTRAL'],
    b: ['CN-SOUTHWEST', 'CN-SOUTH'],
  },
  industry: {
    a: ['CN-SOUTHWEST', 'CN-NORTHWEST'],
    b: ['CN-EAST', 'CN-SOUTH'],
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

function computeVoteStat(regionCode: string, topic: TopicId, biasKey: string): RegionVoteStat {
  const topicSeed = TOPICS.findIndex((item) => item.id === topic) + 1;
  const codeHash = hashString(regionCode);
  let countA = 130 + ((codeHash + topicSeed * 37) % 760);
  let countB = 130 + ((codeHash + topicSeed * 53) % 760);

  const bias = TOPIC_BIAS[topic];
  if (bias.a.includes(biasKey)) {
    countA += 120;
    countB = Math.max(70, countB - 45);
  }

  if (bias.b.includes(biasKey)) {
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

function levelLabel(level: MapTooltipContext['level']): string {
  if (level === 'country') {
    return '국가(중국)';
  }
  if (level === 'province') {
    return '성급(성/직할시)';
  }
  return '지급시/구군';
}

export default function CnMapSection() {
  const [activeTopic, setActiveTopic] = useState<TopicId>('economy');
  const [selectedRegion, setSelectedRegion] = useState<RegionSelection | null>(null);

  const countryCodes = useMemo(
    () =>
      ((cnCountryGeo.features ?? []) as CountryFeature[])
        .map((feature) => String(feature.properties?.code ?? '').trim())
        .filter(Boolean),
    [],
  );

  const provinces = useMemo(
    () =>
      ((cnProvincesGeo.features ?? []) as ProvinceFeature[])
        .map((feature) => ({
          code: String(feature.properties?.code ?? '').trim(),
          countryCode: String(feature.properties?.country_code ?? '').trim() || 'CHN',
          regionCode: String(feature.properties?.region_code ?? '').trim(),
        }))
        .filter((item) => Boolean(item.code) && Boolean(item.countryCode) && Boolean(item.regionCode)),
    [],
  );

  const prefectures = useMemo(
    () =>
      ((cnPrefecturesGeo.features ?? []) as PrefectureFeature[])
        .map((feature) => ({
          code: String(feature.properties?.code ?? '').trim(),
          countryCode: String(feature.properties?.country_code ?? '').trim() || 'CHN',
          provinceCode: String(feature.properties?.province_code ?? '').trim(),
          regionCode: String(feature.properties?.region_code ?? '').trim(),
          adminLevel: String(feature.properties?.admin_level ?? '').trim(),
        }))
        .filter(
          (item) =>
            Boolean(item.code) &&
            Boolean(item.countryCode) &&
            Boolean(item.provinceCode) &&
            Boolean(item.regionCode) &&
            Boolean(item.adminLevel),
        ),
    [],
  );

  const statsByCode = useMemo(() => {
    const map: RegionVoteMap = {};

    countryCodes.forEach((countryCode) => {
      map[countryCode] = computeVoteStat(countryCode, activeTopic, countryCode);
    });

    provinces.forEach((province) => {
      map[province.code] = computeVoteStat(province.code, activeTopic, province.regionCode);
    });

    prefectures.forEach((prefecture) => {
      map[prefecture.code] = computeVoteStat(prefecture.code, activeTopic, prefecture.regionCode);
    });

    return map;
  }, [activeTopic, countryCodes, provinces, prefectures]);

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
        <div className="w-[min(340px,calc(100vw-40px))] rounded-xl border border-slate-700 bg-slate-900/95 px-3 py-2.5 text-slate-100 shadow-2xl">
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
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">중국 행정구역 테스트 지도</h1>
        <p className="text-sm text-slate-600 sm:text-base">
          CN 샘플 경계 데이터로 국가/성급(성·직할시)/지급시·구군 전환과 색칠 로직을 검증합니다.
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

      <CnAdminMap
        className="shadow-sm"
        height={620}
        theme="light"
        fillMode="winner"
        showRegionLevelToggle
        defaultRegionLevel="province"
        initialCenter={[104.0, 35.8]}
        initialZoom={3.15}
        provinceZoomThreshold={99}
        zoomThreshold={99}
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
