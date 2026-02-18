'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import type { RegionVoteMap, RegionVoteStat } from '@/components/KoreaAdminMap';

const KoreaAdminMap = dynamic(() => import('@/components/KoreaAdminMap'), { ssr: false });

const TOPICS = [
  { id: 'transport', label: '교통 정책' },
  { id: 'welfare', label: '복지 정책' },
  { id: 'education', label: '교육 정책' },
] as const;

type TopicId = (typeof TOPICS)[number]['id'];

type RegionSelection = {
  code: string;
  name: string;
  level: 'sido' | 'sigungu';
};

type MunicipalityGeoJson = {
  features?: Array<{ properties?: { code?: string } }>;
};

const ALL_SIDO_CODES = [
  '11',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '29',
  '31',
  '32',
  '33',
  '34',
  '35',
  '36',
  '37',
  '38',
  '39',
];

const TOPIC_CODE_BIAS: Record<TopicId, { a: string[]; b: string[] }> = {
  transport: {
    a: ['11', '23', '24', '25', '29', '31', '34', '38'],
    b: ['21', '22', '26', '32', '33', '35', '36', '37'],
  },
  welfare: {
    a: ['11', '21', '23', '31', '32', '33', '34', '35', '39'],
    b: ['22', '24', '25', '26', '29', '36', '37', '38'],
  },
  education: {
    a: ['11', '22', '23', '25', '31', '33', '36', '37', '39'],
    b: ['21', '24', '26', '29', '32', '34', '35', '38'],
  },
};

function computeVoteStat(regionCode: string, topic: TopicId): RegionVoteStat {
  const numericCode = Number(regionCode);
  const topicSeed = TOPICS.findIndex((t) => t.id === topic) + 1;
  const parentSidoCode = regionCode.slice(0, 2);
  const bias = TOPIC_CODE_BIAS[topic];

  let countA = 120 + ((numericCode * 37 + topicSeed * 41) % 880);
  let countB = 120 + ((numericCode * 43 + topicSeed * 29) % 880);

  if (bias.a.includes(parentSidoCode)) {
    countA += 140;
    countB = Math.max(70, countB - 60);
  }

  if (bias.b.includes(parentSidoCode)) {
    countB += 140;
    countA = Math.max(70, countA - 60);
  }

  if ((numericCode + topicSeed) % 19 === 0) {
    countB = countA;
  }

  const winner = countA > countB ? 'A' : countB > countA ? 'B' : 'TIE';
  return {
    countA,
    countB,
    total: countA + countB,
    winner,
  };
}

function buildSidoStats(topic: TopicId): RegionVoteMap {
  const result: RegionVoteMap = {};
  ALL_SIDO_CODES.forEach((code) => {
    result[code] = computeVoteStat(code, topic);
  });
  return result;
}

function mergeMapStats(base: RegionVoteMap, extra: RegionVoteMap): RegionVoteMap {
  return { ...base, ...extra };
}

export default function VoteMapSection() {
  const [activeTopic, setActiveTopic] = useState<TopicId>('transport');
  const [selectedRegion, setSelectedRegion] = useState<RegionSelection | null>(null);
  const [sigunguCodes, setSigunguCodes] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    void fetch('/data/skorea_municipalities_geo_simple.json')
      .then((res) => res.json() as Promise<MunicipalityGeoJson>)
      .then((json) => {
        if (cancelled) {
          return;
        }

        const codes = (json.features ?? [])
          .map((feature) => String(feature.properties?.code ?? ''))
          .filter(Boolean);
        setSigunguCodes(codes);
      })
      .catch(() => {
        if (!cancelled) {
          setSigunguCodes([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const statsByCode = useMemo(() => {
    const sidoStats = buildSidoStats(activeTopic);
    const sigunguStats: RegionVoteMap = {};

    sigunguCodes.forEach((code) => {
      sigunguStats[code] = computeVoteStat(code, activeTopic);
    });

    return mergeMapStats(sidoStats, sigunguStats);
  }, [activeTopic, sigunguCodes]);

  const selectedStat = useMemo(() => {
    if (!selectedRegion) {
      return null;
    }

    return statsByCode[selectedRegion.code] ?? statsByCode[selectedRegion.code.slice(0, 2)] ?? null;
  }, [selectedRegion, statsByCode]);

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-10 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          대한민국 행정구역 투표 지도
        </h1>
        <p className="text-sm text-slate-600 sm:text-base">
          확대 시 시/군/구 단위도 투표 수 기반으로 색상이 적용됩니다. 주제가 바뀌면 전체 색상도 함께 갱신됩니다.
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
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {topic.label}
            </button>
          );
        })}
      </div>

      <KoreaAdminMap
        statsByCode={statsByCode}
        onRegionClick={(region) =>
          setSelectedRegion((prev) =>
            prev && prev.code === region.code && prev.level === region.level ? null : region,
          )
        }
        className="shadow-sm"
      />

      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[rgba(233,73,73,0.9)]" />
          찬성(A)
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[rgba(36,117,255,0.9)]" />
          반대(B)
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[rgba(255,187,0,0.9)]" />
          접전(TIE)
        </span>
      </div>

      <p className="text-xs text-slate-500">
        {sigunguCodes.length > 0
          ? `세부 행정구역 통계 ${sigunguCodes.length}개 반영됨`
          : '세부 행정구역 통계 로딩 중'}
      </p>

      <p className="text-xs text-slate-500">
        선택된 지역:{' '}
        {selectedRegion
          ? `${selectedRegion.name || selectedRegion.code} (${selectedRegion.level === 'sido' ? '시/도' : '시/군/구'})`
          : '없음'}
        {selectedStat
          ? ` · A ${selectedStat.countA ?? 0} / B ${selectedStat.countB ?? 0} / 합계 ${
              selectedStat.total ?? (selectedStat.countA ?? 0) + (selectedStat.countB ?? 0)
            }`
          : ''}
      </p>
    </section>
  );
}
