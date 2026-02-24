'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronDown, ChevronUp, Home, MapPinned, Share2, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { readGuestSessionId } from '@/lib/vote/client-storage';
import type { MapViewRequest, RegionVoteMap } from '@/components/KoreaAdminMap';

const KoreaAdminMap = dynamic(() => import('@/components/KoreaAdminMap'), { ssr: false });

const RESULT_MAP_COLORS = {
  a: 'rgba(255, 90, 0, 0.95)',
  b: 'rgba(30, 120, 255, 0.95)',
  tie: 'rgba(255, 193, 63, 0.95)',
  neutral: 'rgba(42, 34, 30, 0.18)',
} as const;

const DEFAULT_MAP_CENTER: [number, number] = [127.75, 36.18];
const DEFAULT_MAP_ZOOM = 6.1;

type VoteSummaryStat = {
  countA: number;
  countB: number;
  totalVotes: number;
  winner: 'A' | 'B' | 'TIE';
  aPercent: number;
  bPercent: number;
};

type ResultSummaryResponse = {
  topic: {
    id: string;
    title: string;
    status: string;
    optionA: { key: string; label: string; position: 1 };
    optionB: { key: string; label: string; position: 2 };
  };
  viewer: {
    type: 'user' | 'guest' | 'anonymous';
    hasVote: boolean;
  };
  nationwide: VoteSummaryStat;
  myRegion:
    | (VoteSummaryStat & {
        level: 'sido' | 'sigungu';
        code: string;
        name: string;
        centroid: {
          lat: number;
          lng: number;
        } | null;
      })
    | null;
  myChoice:
    | {
        optionKey: string;
        label: string | null;
        matchesNationwide: boolean | null;
        matchesMyRegion: boolean | null;
      }
    | null;
};

type RegionStatsResponse = {
  statsByCode?: RegionVoteMap;
};

type SelectedRegion = {
  code: string;
  name: string;
  level: 'sido' | 'sigungu';
};

function winnerText(stat: VoteSummaryStat, optionALabel: string, optionBLabel: string): string {
  if (stat.winner === 'A') {
    return `${optionALabel} 우세`;
  }
  if (stat.winner === 'B') {
    return `${optionBLabel} 우세`;
  }
  return '박빙';
}

function outcomeLabel(value: boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return '판단 불가';
  }
  return value ? '일치' : '불일치';
}

function winnerPercent(stat: VoteSummaryStat): number | null {
  if (stat.winner === 'A') {
    return stat.aPercent;
  }
  if (stat.winner === 'B') {
    return stat.bPercent;
  }
  return null;
}

function buildShareText(data: ResultSummaryResponse): string {
  const regionOutcome = outcomeLabel(data.myChoice?.matchesMyRegion);
  const nationwideOutcome = outcomeLabel(data.myChoice?.matchesNationwide);
  const regionWinnerShare = data.myRegion ? winnerPercent(data.myRegion) : null;
  const nationwideWinnerShare = winnerPercent(data.nationwide);
  const winnerGap =
    regionWinnerShare !== null && nationwideWinnerShare !== null
      ? Math.abs(regionWinnerShare - nationwideWinnerShare)
      : null;

  return [
    `결과: ${data.topic.title}`,
    `내 지역 일치도: ${regionOutcome}`,
    `전국 일치도: ${nationwideOutcome}`,
    `우세 강도 차이: ${winnerGap !== null ? `${winnerGap}%p` : '판단 불가'}`,
    `내 지역: ${data.myRegion ? data.myRegion.name : '지역 정보 없음'}`,
  ].join('\n');
}

function VoteSplitCard({
  title,
  subtitle,
  stat,
  optionALabel,
  optionBLabel,
}: {
  title: string;
  subtitle: string;
  stat: VoteSummaryStat;
  optionALabel: string;
  optionBLabel: string;
}) {
  return (
    <section className="rounded-2xl border border-white/14 bg-white/[0.04] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="mt-0.5 text-xs text-white/58">{subtitle}</p>
        </div>
        <span className="rounded-full border border-white/15 bg-white/8 px-2 py-0.5 text-xs text-white/75">
          {stat.totalVotes.toLocaleString()}명
        </span>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-white/75">{optionALabel}</span>
        <span className="text-[#ffb26b]">{stat.aPercent}%</span>
      </div>

      <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-white/10">
        <div className="flex h-full w-full">
          <div
            className="h-full bg-gradient-to-r from-[#ff6b00] to-[#ff9f0a]"
            style={{ width: `${stat.aPercent}%` }}
          />
          <div
            className="h-full bg-gradient-to-r from-[#2f74ff] to-[#6ea6ff]"
            style={{ width: `${stat.bPercent}%` }}
          />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-white/75">{optionBLabel}</span>
        <span className="text-[#8fb8ff]">{stat.bPercent}%</span>
      </div>

      <p className="mt-3 text-xs font-medium text-white/65">
        현재 흐름: {winnerText(stat, optionALabel, optionBLabel)}
      </p>
    </section>
  );
}

export function ResultComparisonPage({ topicId }: { topicId: string }) {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isMapLoading, setIsMapLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ResultSummaryResponse | null>(null);
  const [mapStats, setMapStats] = useState<RegionVoteMap>({});
  const [selectedRegion, setSelectedRegion] = useState<SelectedRegion | null>(null);
  const [isDetailExpanded, setIsDetailExpanded] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<'region' | 'nationwide'>('region');
  const [isIntroSheetOpen, setIsIntroSheetOpen] = useState(false);
  const [mapViewRequest, setMapViewRequest] = useState<MapViewRequest | undefined>(undefined);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const introSheetRef = useRef<HTMLDivElement | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  const showNotice = useCallback((message: string) => {
    setNoticeMessage(message);
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setNoticeMessage(null);
      noticeTimerRef.current = null;
    }, 1800);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const closeIntroSheet = useCallback(
    () => {
      setIsIntroSheetOpen(false);
    },
    [],
  );

  const loadResultSummary = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      let accessToken: string | null = null;
      if (isAuthenticated) {
        const supabase = getSupabaseBrowserClient();
        if (supabase) {
          const { data: sessionData } = await supabase.auth.getSession();
          accessToken = sessionData.session?.access_token ?? null;
        }
      }

      const guestSessionId = !isAuthenticated ? readGuestSessionId() : null;
      const query = new URLSearchParams({ topicId });
      if (guestSessionId) {
        query.set('guestSessionId', guestSessionId);
      }

      const response = await fetch(`/api/votes/result-summary?${query.toString()}`, {
        cache: 'no-store',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });

      const json = (await response.json()) as ResultSummaryResponse & { error?: string };
      if (!response.ok) {
        setError(json.error ?? '결과 정보를 불러오지 못했습니다.');
        setData(null);
        return;
      }

      setData(json);
    } catch {
      setError('결과 정보를 불러오지 못했습니다.');
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, topicId]);

  const loadMapStats = useCallback(async () => {
    setIsMapLoading(true);
    try {
      const nonce = Date.now();
      const [sidoRes, sigunguRes] = await Promise.allSettled([
        fetch(`/api/votes/region-stats?topicId=${encodeURIComponent(topicId)}&level=sido&ts=${nonce}`, {
          cache: 'no-store',
        }),
        fetch(`/api/votes/region-stats?topicId=${encodeURIComponent(topicId)}&level=sigungu&ts=${nonce}`, {
          cache: 'no-store',
        }),
      ]);

      let sidoJson: RegionStatsResponse | null = null;
      let sigunguJson: RegionStatsResponse | null = null;

      if (sidoRes.status === 'fulfilled' && sidoRes.value.ok) {
        sidoJson = (await sidoRes.value.json()) as RegionStatsResponse;
      }
      if (sigunguRes.status === 'fulfilled' && sigunguRes.value.ok) {
        sigunguJson = (await sigunguRes.value.json()) as RegionStatsResponse;
      }

      setMapStats({
        ...(sidoJson?.statsByCode ?? {}),
        ...(sigunguJson?.statsByCode ?? {}),
      });
    } catch {
      setMapStats({});
    } finally {
      setIsMapLoading(false);
    }
  }, [topicId]);

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }
    void loadResultSummary();
    void loadMapStats();
  }, [isAuthLoading, loadMapStats, loadResultSummary]);

  useEffect(() => {
    if (!data?.myRegion) {
      return;
    }

    setSelectedRegion({
      code: data.myRegion.code,
      name: data.myRegion.name,
      level: data.myRegion.level,
    });
  }, [data?.myRegion]);

  useEffect(() => {
    if (!data) {
      return;
    }
    setIsIntroSheetOpen(true);
  }, [data]);

  useEffect(() => {
    if (activeDetailTab === 'region' && !data?.myRegion) {
      setActiveDetailTab('nationwide');
    }
  }, [activeDetailTab, data?.myRegion]);

  useEffect(() => {
    if (!isIntroSheetOpen) {
      return;
    }

    const dialog = introSheetRef.current;
    const previousFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusable = dialog
      ? Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => !element.hasAttribute('disabled'))
      : [];
    const firstFocusable = focusable[0];
    const lastFocusable = focusable[focusable.length - 1];

    if (firstFocusable) {
      firstFocusable.focus();
    } else {
      dialog?.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeIntroSheet();
        return;
      }

      if (event.key !== 'Tab' || !dialog || focusable.length === 0) {
        return;
      }

      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable?.focus();
        return;
      }

      if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previousFocusedElement?.focus();
    };
  }, [closeIntroSheet, isIntroSheetOpen]);

  const shareText = useMemo(() => (data ? buildShareText(data) : ''), [data]);
  const regionMatchLabel = useMemo(
    () => outcomeLabel(data?.myChoice?.matchesMyRegion),
    [data?.myChoice?.matchesMyRegion],
  );
  const nationwideMatchLabel = useMemo(
    () => outcomeLabel(data?.myChoice?.matchesNationwide),
    [data?.myChoice?.matchesNationwide],
  );
  const regionOutcomeToneClass = useMemo(() => {
    if (!data?.myChoice || data.myChoice.matchesMyRegion === null) {
      return 'text-white/72';
    }
    return data.myChoice.matchesMyRegion ? 'text-[#8ff0b5]' : 'text-[#ffcc99]';
  }, [data?.myChoice]);
  const nationwideOutcomeToneClass = useMemo(() => {
    if (!data?.myChoice || data.myChoice.matchesNationwide === null) {
      return 'text-white/72';
    }
    return data.myChoice.matchesNationwide ? 'text-[#8ff0b5]' : 'text-[#ffcc99]';
  }, [data?.myChoice]);
  const nationwideWinnerShare = useMemo(
    () => (data ? winnerPercent(data.nationwide) : null),
    [data],
  );
  const regionWinnerShare = useMemo(
    () => (data?.myRegion ? winnerPercent(data.myRegion) : null),
    [data],
  );
  const winnerShareGap = useMemo(() => {
    if (regionWinnerShare === null || nationwideWinnerShare === null) {
      return null;
    }
    return Math.abs(regionWinnerShare - nationwideWinnerShare);
  }, [nationwideWinnerShare, regionWinnerShare]);
  const regionNationFlow = useMemo(() => {
    if (!data?.myRegion) {
      return { label: '판단 불가', toneClass: 'text-white/72' };
    }

    const aligned = data.myRegion.winner === data.nationwide.winner;
    return {
      label: aligned ? '같은 흐름' : '다른 흐름',
      toneClass: aligned ? 'text-[#8ff0b5]' : 'text-[#ffcc99]',
    };
  }, [data]);
  const selectedRegionStat = useMemo(() => {
    if (!selectedRegion) {
      return null;
    }
    return mapStats[selectedRegion.code] ?? null;
  }, [mapStats, selectedRegion]);

  const selectedRegionBreakdown = useMemo(() => {
    if (!selectedRegionStat) {
      return null;
    }

    const countA = selectedRegionStat.countA ?? 0;
    const countB = selectedRegionStat.countB ?? 0;
    const total = selectedRegionStat.total ?? countA + countB;
    const aPercent = total > 0 ? Math.round((countA / total) * 100) : 0;
    const bPercent = total > 0 ? Math.max(0, 100 - aPercent) : 0;

    return {
      countA,
      countB,
      total,
      aPercent,
      bPercent,
    };
  }, [selectedRegionStat]);

  const hasRegionDetail = Boolean(data?.myRegion);

  const handleInstantShare = useCallback(async () => {
    if (!data || typeof window === 'undefined') {
      return;
    }

    const sharePayload = `${shareText}\n${window.location.href}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `Vote War Map · ${data.topic.title}`,
          text: shareText,
          url: window.location.href,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
      }
    }

    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(sharePayload);
        showNotice('링크를 복사했어요.');
        return;
      } catch {
        // clipboard write fallback below
      }
    }

    showNotice('공유를 지원하지 않는 환경입니다.');
  }, [data, shareText, showNotice]);

  const handleMapView = useCallback(() => {
    closeIntroSheet();

    if (!data?.myRegion) {
      setSelectedRegion(null);
      setMapViewRequest({
        id: `view-${Date.now()}`,
        center: DEFAULT_MAP_CENTER,
        zoom: DEFAULT_MAP_ZOOM,
        reason: 'reset',
      });
      showNotice('내 지역 정보가 없어 전국 화면으로 이동했어요.');
      return;
    }

    setSelectedRegion({
      code: data.myRegion.code,
      name: data.myRegion.name,
      level: data.myRegion.level,
    });

    if (!data.myRegion.centroid) {
      setMapViewRequest({
        id: `view-${Date.now()}`,
        center: DEFAULT_MAP_CENTER,
        zoom: DEFAULT_MAP_ZOOM,
        reason: 'reset',
      });
      showNotice('지역 좌표를 찾지 못해 전국 화면으로 이동했어요.');
      return;
    }

    setMapViewRequest({
      id: `view-${Date.now()}`,
      center: [data.myRegion.centroid.lng, data.myRegion.centroid.lat],
      zoom: data.myRegion.level === 'sigungu' ? 8.6 : 7.4,
      reason: 'my-region-focus',
    });
  }, [closeIntroSheet, data, showNotice]);

  return (
    <main className="relative h-[100dvh] min-h-dvh w-full overflow-hidden bg-black text-white touch-manipulation [font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text','SF_Pro_Display','Segoe_UI',sans-serif]">
      <div className="absolute inset-0">
        <KoreaAdminMap
          key={`${topicId}-${Object.keys(mapStats).length}`}
          statsByCode={mapStats}
          height="100%"
          initialCenter={DEFAULT_MAP_CENTER}
          initialZoom={6}
          theme="dark"
          colors={RESULT_MAP_COLORS}
          showNavigationControl={false}
          showTooltip={false}
          showRegionLevelToggle
          viewRequest={mapViewRequest}
          onRegionClick={(region) =>
            setSelectedRegion((prev) => (prev && prev.code === region.code && prev.level === region.level ? null : region))
          }
          className="h-full w-full !rounded-none !border-0"
        />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,_rgba(4,10,18,0.36),_rgba(4,10,18,0.12)_40%,_rgba(4,10,18,0.52))]" />
      <div className="pointer-events-none absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 mix-blend-soft-light" />

      <div className="pointer-events-none relative z-20 mx-auto flex h-full w-full max-w-[430px] flex-col px-4 pt-[calc(0.6rem+env(safe-area-inset-top))] pb-[calc(0.65rem+env(safe-area-inset-bottom))]">
        {isLoading ? (
          <section className="pointer-events-auto mt-3 space-y-3 rounded-[24px] border border-white/14 bg-[rgba(18,20,28,0.76)] p-4 shadow-[0_10px_28px_rgba(0,0,0,0.34)] backdrop-blur-2xl">
            <div className="h-5 w-44 animate-pulse rounded bg-white/14" />
            <div className="h-4 w-64 animate-pulse rounded bg-white/12" />
            <div className="h-20 animate-pulse rounded-2xl bg-white/10" />
            <div className="h-20 animate-pulse rounded-2xl bg-white/10" />
          </section>
        ) : error ? (
          <section className="pointer-events-auto mt-3 rounded-[24px] border border-white/14 bg-[rgba(18,20,28,0.78)] p-4 shadow-[0_10px_28px_rgba(0,0,0,0.34)] backdrop-blur-2xl">
            <p className="text-sm font-semibold text-[#ffb4b4]">{error}</p>
            <button
              type="button"
              onClick={() => {
                void loadResultSummary();
                void loadMapStats();
              }}
              className="mt-4 inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-xl border border-white/22 bg-white/12 text-sm font-semibold text-white/92 transition hover:bg-white/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              다시 시도
            </button>
          </section>
        ) : data ? (
          <>
            <div className="pointer-events-auto mt-auto max-h-[46dvh] space-y-3 overflow-y-auto overscroll-contain pr-1 pb-[calc(0.35rem+env(safe-area-inset-bottom))]">
              <section className="rounded-[22px] border border-white/16 bg-[rgba(17,20,30,0.7)] p-3.5 shadow-[0_10px_24px_rgba(0,0,0,0.34)] backdrop-blur-xl">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">지역 상세</p>
                  {isMapLoading ? (
                    <span className="shrink-0 rounded-full border border-white/15 bg-white/8 px-2 py-0.5 text-[11px] text-white/72">
                      지도 로딩중
                    </span>
                  ) : null}
                </div>
                {selectedRegion ? (
                  selectedRegionBreakdown ? (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="truncate text-[15px] font-semibold text-white">{selectedRegion.name}</p>
                        <span className="rounded-full border border-white/15 bg-white/9 px-2.5 py-0.5 text-[11px] text-white/72">
                          {selectedRegion.level === 'sido' ? '시/도' : '시/군/구'}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-white/84">
                        <span>
                          {data.topic.optionA.label} {selectedRegionBreakdown.aPercent}%
                        </span>
                        <span>
                          {data.topic.optionB.label} {selectedRegionBreakdown.bPercent}%
                        </span>
                      </div>
                      <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-white/12">
                        <div className="h-full bg-[#ff6b00]" style={{ width: `${selectedRegionBreakdown.aPercent}%` }} />
                        <div className="h-full bg-[#2f74ff]" style={{ width: `${selectedRegionBreakdown.bPercent}%` }} />
                      </div>
                      <p className="mt-2 text-xs text-white/68">
                        참여 {selectedRegionBreakdown.total.toLocaleString()}표 · {data.topic.optionA.label}{' '}
                        {selectedRegionBreakdown.countA.toLocaleString()} · {data.topic.optionB.label}{' '}
                        {selectedRegionBreakdown.countB.toLocaleString()}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-white/65">이 지역에는 아직 투표 데이터가 없습니다.</p>
                  )
                ) : (
                  <p className="text-xs text-white/68">지도를 눌러 지역별 결과를 확인해 보세요.</p>
                )}
              </section>

              <section className="rounded-[22px] border border-white/16 bg-[rgba(17,20,30,0.7)] p-3.5 shadow-[0_10px_24px_rgba(0,0,0,0.34)] backdrop-blur-xl">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-white">상세 비교</p>
                    <p className="mt-0.5 text-xs text-white/62">핵심 요약 후 필요할 때만 세부 분포를 확인하세요.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsDetailExpanded((prev) => !prev)}
                    className="inline-flex h-11 min-w-[88px] cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-white/18 bg-white/10 px-3 text-xs font-semibold text-white/90 transition hover:bg-white/16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  >
                    {isDetailExpanded ? (
                      <>
                        접기
                        <ChevronUp className="h-4 w-4" />
                      </>
                    ) : (
                      <>
                        펼치기
                        <ChevronDown className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </div>

                {isDetailExpanded ? (
                  <>
                    <div
                      role="tablist"
                      aria-label="비교 상세 탭"
                      className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-white/14 bg-white/6 p-1"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeDetailTab === 'region'}
                        onClick={() => setActiveDetailTab('region')}
                        disabled={!hasRegionDetail}
                        className={`inline-flex h-10 cursor-pointer items-center justify-center rounded-lg text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                          activeDetailTab === 'region'
                            ? 'border border-[#ff9f0a6d] bg-[#ff6b00] text-white'
                            : 'border border-transparent bg-transparent text-white/75 hover:bg-white/10'
                        } ${!hasRegionDetail ? '!cursor-not-allowed !text-white/42 hover:!bg-transparent' : ''}`}
                      >
                        내 지역
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeDetailTab === 'nationwide'}
                        onClick={() => setActiveDetailTab('nationwide')}
                        className={`inline-flex h-10 cursor-pointer items-center justify-center rounded-lg text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                          activeDetailTab === 'nationwide'
                            ? 'border border-[#4f8dff80] bg-[#2f74ff] text-white'
                            : 'border border-transparent bg-transparent text-white/75 hover:bg-white/10'
                        }`}
                      >
                        전국
                      </button>
                    </div>

                    <div className="mt-3">
                      {activeDetailTab === 'region' ? (
                        data.myRegion ? (
                          <VoteSplitCard
                            title="내 지역"
                            subtitle={`${data.myRegion.name} 기준`}
                            stat={data.myRegion}
                            optionALabel={data.topic.optionA.label}
                            optionBLabel={data.topic.optionB.label}
                          />
                        ) : (
                          <section className="rounded-2xl border border-white/14 bg-[rgba(18,20,28,0.68)] p-4 backdrop-blur-xl">
                            <p className="text-sm font-semibold text-white">내 지역</p>
                            <p className="mt-1 text-xs text-white/62">내 지역 정보가 아직 저장되지 않아 비교를 표시할 수 없습니다.</p>
                          </section>
                        )
                      ) : (
                        <VoteSplitCard
                          title="전국"
                          subtitle="전체 사용자 기준"
                          stat={data.nationwide}
                          optionALabel={data.topic.optionA.label}
                          optionBLabel={data.topic.optionB.label}
                        />
                      )}
                    </div>
                  </>
                ) : (
                  <p className="mt-3 rounded-xl border border-white/14 bg-white/6 px-3 py-2 text-xs text-white/70">
                    지금은 핵심 비교 지표를 요약 팝업에서 우선 제공합니다.
                  </p>
                )}
              </section>
            </div>

            {noticeMessage ? (
              <div className="pointer-events-none mt-2 rounded-xl border border-white/18 bg-[rgba(14,18,28,0.72)] px-3 py-2 text-center text-xs font-medium text-white/86 backdrop-blur-xl">
                {noticeMessage}
              </div>
            ) : null}

            <section className="pointer-events-auto mt-2 rounded-[20px] border border-white/15 bg-[rgba(14,18,28,0.64)] p-2 shadow-[0_8px_20px_rgba(0,0,0,0.24)] backdrop-blur-xl">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setIsIntroSheetOpen(true)}
                  className="inline-flex h-11 min-w-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-white/18 bg-white/10 px-2 text-xs font-semibold text-white/92 transition hover:bg-white/16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  <Share2 className="h-4 w-4" />
                  요약
                </button>
                <Link
                  href="/"
                  className="inline-flex h-11 min-w-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-white/18 bg-white/10 px-2 text-xs font-semibold text-white/92 transition hover:bg-white/16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  <Home className="h-4 w-4" />
                  홈
                </Link>
                <Link
                  href="/topics-map"
                  className="inline-flex h-11 min-w-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-white/18 bg-white/10 px-2 text-xs font-semibold text-white/92 transition hover:bg-white/16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  <MapPinned className="h-4 w-4" />
                  지도
                </Link>
              </div>
            </section>
          </>
        ) : null}
      </div>

      {isIntroSheetOpen && data ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(22,44,74,0.62),_rgba(0,0,0,0.76)_58%)] backdrop-blur-[2px]"
            aria-hidden="true"
          />
          <section
            ref={introSheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="결과 요약"
            tabIndex={-1}
            className="relative w-full max-w-[390px] overflow-hidden rounded-[30px] border border-white/18 bg-[linear-gradient(155deg,rgba(9,15,25,0.98),rgba(10,18,30,0.98))] p-3.5 shadow-[0_30px_60px_rgba(0,0,0,0.52)]"
          >
            <div className="pointer-events-none absolute -left-16 top-16 h-36 w-36 rounded-full bg-[#ff6b0033] blur-3xl" />
            <div className="pointer-events-none absolute -right-16 -top-10 h-40 w-40 rounded-full bg-[#2f74ff33] blur-3xl" />

            <div className="relative">
              <div className="rounded-[22px] border border-white/16 bg-[rgba(9,18,33,0.78)] p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/62">
                      MATCH SUMMARY
                    </p>
                    <h1 className="mt-1 text-[18px] font-extrabold leading-tight text-white">{data.topic.title}</h1>
                  </div>
                  <button
                    type="button"
                    onClick={closeIntroSheet}
                    className="inline-flex h-11 min-w-[44px] cursor-pointer items-center justify-center rounded-xl border border-white/24 bg-white/10 px-2 text-white transition hover:bg-white/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/45"
                    aria-label="요약 팝업 닫기"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-[#ff9f0a75] bg-[#ff6b0026] px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#ffc789]">TEAM A</p>
                    <p className="mt-1 truncate text-sm font-semibold text-white">{data.topic.optionA.label}</p>
                  </div>
                  <div className="rounded-xl border border-[#6ea6ff78] bg-[#2f74ff24] px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#b7d3ff]">TEAM B</p>
                    <p className="mt-1 truncate text-sm font-semibold text-white">{data.topic.optionB.label}</p>
                  </div>
                </div>
              </div>

              <section className="mt-3 rounded-[20px] border border-white/16 bg-white/[0.04] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/62">핵심 비교 지표</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-white/14 bg-[rgba(255,255,255,0.04)] px-3 py-2.5">
                    <p className="text-[11px] font-semibold text-white/64">내 지역 일치도</p>
                    <p className={`mt-1 text-[18px] font-bold ${regionOutcomeToneClass}`}>{regionMatchLabel}</p>
                  </div>
                  <div className="rounded-xl border border-white/14 bg-[rgba(255,255,255,0.04)] px-3 py-2.5">
                    <p className="text-[11px] font-semibold text-white/64">전국 일치도</p>
                    <p className={`mt-1 text-[18px] font-bold ${nationwideOutcomeToneClass}`}>{nationwideMatchLabel}</p>
                  </div>
                  <div className="rounded-xl border border-white/14 bg-[rgba(255,255,255,0.04)] px-3 py-2.5">
                    <p className="text-[11px] font-semibold text-white/64">우세 강도 차이</p>
                    <p className="mt-1 text-[18px] font-bold text-[#8ec2ff]">
                      {winnerShareGap !== null ? `${winnerShareGap}%p` : '판단 불가'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/14 bg-[rgba(255,255,255,0.04)] px-3 py-2.5">
                    <p className="text-[11px] font-semibold text-white/64">지역↔전국 흐름</p>
                    <p className={`mt-1 text-[18px] font-bold ${regionNationFlow.toneClass}`}>{regionNationFlow.label}</p>
                  </div>
                </div>

                <div className="mt-2.5 rounded-xl border border-white/12 bg-[rgba(255,255,255,0.03)] px-3 py-2.5">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-white/70">
                    <span>{data.myRegion ? data.myRegion.name : '내 지역'} 우세 비율</span>
                    <span>{regionWinnerShare !== null ? `${regionWinnerShare}%` : '-'}</span>
                  </div>
                  <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-white/12">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#ff7b13] via-[#ffad4d] to-[#6ea6ff]"
                      style={{ width: `${regionWinnerShare ?? 0}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-right text-[11px] text-white/58">
                    전국 우세 비율 {nationwideWinnerShare !== null ? `${nationwideWinnerShare}%` : '-'}
                  </p>
                </div>
              </section>

              {!data.myRegion ? (
                <p className="mt-2.5 rounded-xl border border-white/14 bg-[rgba(255,255,255,0.04)] px-3 py-2 text-xs text-white/66">
                  내 지역 정보가 없어 지도 보기는 전국 기본 화면으로 이동합니다.
                </p>
              ) : null}

              <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-white/18 bg-white/8 px-2.5 py-1 text-[11px] text-white/72">
                <ShieldCheck className="h-3.5 w-3.5 text-[#8ec2ff]" />
                Verified Region · {data.myRegion ? data.myRegion.name : '지역 미확인'}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void handleInstantShare()}
                  className="inline-flex h-12 min-w-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#6ea6ff7a] bg-gradient-to-r from-[#2f74ff] to-[#45b4de] px-3 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(55,118,232,0.28)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87beff]"
                >
                  <Share2 className="h-4 w-4" />
                  공유
                </button>
                <button
                  type="button"
                  onClick={handleMapView}
                  className="inline-flex h-12 min-w-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#ff9f0a7a] bg-gradient-to-r from-[#ff7d1b] to-[#ff9f0a] px-3 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(255,126,26,0.24)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffc074]"
                >
                  <MapPinned className="h-4 w-4" />
                  지도 보기
                </button>
              </div>

              <button
                type="button"
                onClick={closeIntroSheet}
                className="mt-2 inline-flex h-11 w-full min-w-[44px] cursor-pointer items-center justify-center rounded-xl border border-white/16 bg-white/[0.03] text-sm font-medium text-white/68 transition hover:bg-white/[0.08] hover:text-white/92 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                닫기
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
