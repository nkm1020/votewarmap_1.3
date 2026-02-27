'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DesktopTopHeader } from '@/components/ui/desktop-top-header';
import { useAuth } from '@/contexts/AuthContext';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { readGuestSessionId } from '@/lib/vote/client-storage';
import type { MapTooltipContext, MapViewRequest, RegionVoteMap } from '@/components/KoreaAdminMap';
import { VoteResultModal } from '@/components/results/VoteResultModal';
import type { VoteTopic } from '@/lib/vote/types';

const KoreaAdminMap = dynamic(() => import('@/components/KoreaAdminMap'), { ssr: false });

const RESULT_MAP_COLORS = {
  a: 'rgba(255, 90, 0, 0.95)',
  b: 'rgba(30, 120, 255, 0.95)',
  tie: 'rgba(255, 193, 63, 0.95)',
  neutral: 'rgba(42, 34, 30, 0.18)',
} as const;

const DEFAULT_MAP_CENTER: [number, number] = [127.75, 36.18];
const DEFAULT_MAP_ZOOM = 6.1;
const AUTO_OPEN_RESULT_MODAL = true;
type ResultEntryMode = 'default' | 'map';
type TopicCategory = 'food' | 'relationship' | 'work' | 'imagination';
type TopicTab = 'all' | TopicCategory;

const TOPIC_TAB_META: Array<{ id: TopicTab; label: string }> = [
  { id: 'all', label: '전체' },
  { id: 'food', label: '음식&취향' },
  { id: 'relationship', label: '연애&인간관계' },
  { id: 'work', label: '직장&일상' },
  { id: 'imagination', label: '황당한 상상' },
];

const KO_TOPIC_COLLATOR = new Intl.Collator('ko', {
  sensitivity: 'base',
  numeric: true,
});

const MANUAL_TOPIC_CATEGORY_BY_ID: Record<string, TopicCategory> = {
  'balance-love-2026': 'relationship',
  'balance-work-2026': 'work',
};

type VoteSummaryStat = {
  countA: number;
  countB: number;
  totalVotes: number;
  winner: 'A' | 'B' | 'TIE';
  aPercent: number;
  bPercent: number;
};

type ResultVisibility = 'locked' | 'unlocked';

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
  visibility: ResultVisibility;
  preview: {
    gapPercent: number;
    totalVotes: number;
  } | null;
  nationwide: VoteSummaryStat | null;
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

type ResultSummaryUnlockedResponse = ResultSummaryResponse & {
  visibility: 'unlocked';
  preview: null;
  nationwide: VoteSummaryStat;
};

type RegionStatsResponse = {
  visibility?: ResultVisibility;
  statsByCode?: RegionVoteMap;
};

type SelectedRegion = {
  code: string;
  name: string;
  level: 'sido' | 'sigungu';
};

function buildRegionBreakdown(stat: MapTooltipContext['stat'] | null | undefined) {
  if (!stat) {
    return null;
  }

  const countA = stat.countA ?? 0;
  const countB = stat.countB ?? 0;
  const total = stat.total ?? countA + countB;
  const aPercent = total > 0 ? Math.round((countA / total) * 100) : 0;
  const bPercent = total > 0 ? Math.max(0, 100 - aPercent) : 0;

  return {
    countA,
    countB,
    total,
    aPercent,
    bPercent,
  };
}

function categorizeTopic(topic: VoteTopic): TopicCategory {
  const manual = MANUAL_TOPIC_CATEGORY_BY_ID[topic.id];
  if (manual) {
    return manual;
  }

  if (topic.id.startsWith('food-')) {
    return 'food';
  }

  if (topic.id.startsWith('rel-')) {
    return 'relationship';
  }

  if (topic.id.startsWith('work-')) {
    return 'work';
  }

  if (topic.id.startsWith('imagination-')) {
    return 'imagination';
  }

  return 'imagination';
}

function buildShareText(data: ResultSummaryUnlockedResponse): string {
  const nationwideSummary = `${data.topic.optionA.label} ${data.nationwide.aPercent}% vs ${data.topic.optionB.label} ${data.nationwide.bPercent}%`;
  const regionName = data.myRegion?.name ?? '지역 데이터 수집 중';
  const regionSummary = data.myRegion
    ? `${data.topic.optionA.label} ${data.myRegion.aPercent}% vs ${data.topic.optionB.label} ${data.myRegion.bPercent}%`
    : '지역 데이터 수집 중';

  return [
    `"${data.topic.title}"`,
    `전국: ${nationwideSummary}`,
    `우리 동네(${regionName}): ${regionSummary}`,
    '지금 투표하고 결과 바꿔봐!',
  ].join('\n');
}

export function ResultComparisonPage({
  topicId,
  entryMode = 'default',
}: {
  topicId: string;
  entryMode?: ResultEntryMode;
}) {
  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ResultSummaryUnlockedResponse | null>(null);
  const [mapStats, setMapStats] = useState<RegionVoteMap>({});
  const [selectedRegion, setSelectedRegion] = useState<SelectedRegion | null>(null);
  const [isIntroSheetOpen, setIsIntroSheetOpen] = useState(false);
  const [isBottomSheetExpanded, setIsBottomSheetExpanded] = useState(false);
  const [availableTopics, setAvailableTopics] = useState<VoteTopic[]>([]);
  const [isTopicsLoading, setIsTopicsLoading] = useState(false);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [activeTopicTab, setActiveTopicTab] = useState<TopicTab>('all');
  const [expandedPickerTopicId, setExpandedPickerTopicId] = useState<string | null>(null);
  const [pickerSelectedOptionKey, setPickerSelectedOptionKey] = useState<string | null>(null);
  const [pickerVoteMessage, setPickerVoteMessage] = useState<string | null>(null);
  const [mapViewRequest, setMapViewRequest] = useState<MapViewRequest | undefined>(undefined);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  const [isDesktopLeftPanelOpen, setIsDesktopLeftPanelOpen] = useState(true);
  const noticeTimerRef = useRef<number | null>(null);
  const selectedRegionPanelRef = useRef<HTMLElement | null>(null);
  const openSheetRef = useRef<HTMLElement | null>(null);
  const hasAutoOpenedIntroRef = useRef(false);

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

  const shouldAutoOpenIntroModal = AUTO_OPEN_RESULT_MODAL && entryMode !== 'map';

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const closeIntroSheet = useCallback(() => {
    setIsIntroSheetOpen(false);
  }, []);

  const loadResultSummary = useCallback(async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
      setError(null);
    }

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
        if (!silent) {
          setError(json.error ?? '결과 정보를 불러오지 못했습니다.');
          setData(null);
        }
        return;
      }

      if (json.visibility === 'locked') {
        const redirectQuery = new URLSearchParams({
          topics: topicId,
          openTopicEditor: '1',
          redirectResultTopicId: topicId,
        });
        router.replace(`/topics-map?${redirectQuery.toString()}`);
        setData(null);
        if (!silent) {
          setError(null);
        }
        return;
      }

      if (!json.nationwide || json.preview !== null) {
        if (!silent) {
          setError('결과 정보를 불러오지 못했습니다.');
          setData(null);
        }
        return;
      }

      setData(json as ResultSummaryUnlockedResponse);
    } catch {
      if (!silent) {
        setError('결과 정보를 불러오지 못했습니다.');
        setData(null);
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, [isAuthenticated, router, topicId]);

  const loadMapStats = useCallback(async () => {
    try {
      let accessToken: string | null = null;
      if (isAuthenticated) {
        const supabase = getSupabaseBrowserClient();
        if (supabase) {
          const { data: sessionData } = await supabase.auth.getSession();
          accessToken = sessionData.session?.access_token ?? null;
        }
      }

      const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
      const guestSessionId = !isAuthenticated ? readGuestSessionId() : null;
      const nonce = Date.now();
      const buildStatsUrl = (level: 'sido' | 'sigungu') => {
        const query = new URLSearchParams({
          scope: 'topic',
          topicId,
          level,
          ts: String(nonce),
        });
        if (guestSessionId) {
          query.set('guestSessionId', guestSessionId);
        }
        return `/api/votes/region-stats?${query.toString()}`;
      };
      const [sidoRes, sigunguRes] = await Promise.allSettled([
        fetch(buildStatsUrl('sido'), { cache: 'no-store', headers }),
        fetch(buildStatsUrl('sigungu'), { cache: 'no-store', headers }),
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
    }
  }, [isAuthenticated, topicId]);

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }
    void loadResultSummary();
    void loadMapStats();
  }, [isAuthLoading, loadMapStats, loadResultSummary]);

  useEffect(() => {
    if (!data || !shouldAutoOpenIntroModal || hasAutoOpenedIntroRef.current) {
      return;
    }
    hasAutoOpenedIntroRef.current = true;
    setIsIntroSheetOpen(true);
  }, [data, shouldAutoOpenIntroModal]);

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadResultSummary(true);
      void loadMapStats();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isAuthLoading, loadMapStats, loadResultSummary]);

  const shareText = useMemo(() => (data ? buildShareText(data) : ''), [data]);
  const myChoiceSide = useMemo<'A' | 'B' | null>(() => {
    if (!data?.myChoice) {
      return null;
    }
    if (data.myChoice.optionKey === data.topic.optionA.key) {
      return 'A';
    }
    if (data.myChoice.optionKey === data.topic.optionB.key) {
      return 'B';
    }
    return null;
  }, [data]);
  const selectedRegionStat = useMemo(() => {
    if (!selectedRegion) {
      return null;
    }
    return mapStats[selectedRegion.code] ?? null;
  }, [mapStats, selectedRegion]);

  const selectedRegionBreakdown = useMemo(() => {
    return buildRegionBreakdown(selectedRegionStat);
  }, [selectedRegionStat]);
  const renderRegionTooltipContent = useCallback(
    (context: MapTooltipContext) => {
      const breakdown = buildRegionBreakdown(context.stat);
      return (
        <div className="w-[min(340px,calc(100vw-44px))] rounded-[20px] border border-white/14 bg-[rgba(12,18,28,0.78)] p-3.5 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
          <div className="flex items-center justify-between">
            <h4 className="truncate pr-2 text-[15px] font-semibold text-white">{context.name || context.code}</h4>
            <span className="rounded-full border border-white/18 bg-white/8 px-2.5 py-1 text-[11px] font-semibold text-white/75">
              {context.level === 'sido' ? '시/도' : '시/군/구'}
            </span>
          </div>

          {data ? (
            breakdown ? (
              <>
                <p className="mt-2 text-[12px] text-white/68">
                  누적 투표수 <span className="font-semibold text-white">{breakdown.total.toLocaleString()}표</span>
                </p>
                <div className="mt-2 flex items-center justify-between text-xs text-white/84">
                  <span>
                    {data.topic.optionA.label} {breakdown.aPercent}%
                  </span>
                  <span>
                    {data.topic.optionB.label} {breakdown.bPercent}%
                  </span>
                </div>
                <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-white/12">
                  <div className="h-full bg-[#ff6b00]" style={{ width: `${breakdown.aPercent}%` }} />
                  <div className="h-full bg-[#2f74ff]" style={{ width: `${breakdown.bPercent}%` }} />
                </div>
              </>
            ) : (
              <p className="mt-2 text-xs text-white/62">투표 데이터가 아직 없습니다.</p>
            )
          ) : (
            <p className="mt-2 text-xs text-white/62">결과 정보를 불러오는 중입니다.</p>
          )}
        </div>
      );
    },
    [data],
  );

  const nationwideBar = useMemo(() => {
    if (!data) {
      return {
        a: 0,
        b: 0,
        displayA: 0,
        displayB: 0,
        winner: 'TIE' as const,
        gap: 0,
      };
    }
    const a = Math.max(0, Math.min(100, data.nationwide.aPercent));
    const b = Math.max(0, Math.min(100, data.nationwide.bPercent));
    const minVisible = 8;
    let displayA = a;
    let displayB = b;

    if (a === 0 && b === 100) {
      displayA = minVisible;
      displayB = 100 - minVisible;
    } else if (b === 0 && a === 100) {
      displayA = 100 - minVisible;
      displayB = minVisible;
    } else if (a < minVisible) {
      displayA = minVisible;
      displayB = 100 - minVisible;
    } else if (b < minVisible) {
      displayA = 100 - minVisible;
      displayB = minVisible;
    }

    return {
      a,
      b,
      displayA,
      displayB,
      winner: a === b ? ('TIE' as const) : a > b ? ('A' as const) : ('B' as const),
      gap: Math.abs(a - b),
    };
  }, [data]);

  const sortedTopics = useMemo(
    () =>
      [...availableTopics]
        .filter((topic) => topic.id !== topicId)
        .sort((a, b) => KO_TOPIC_COLLATOR.compare(a.title, b.title)),
    [availableTopics, topicId],
  );
  const topicsByCategory = useMemo(() => {
    const grouped: Record<TopicCategory, VoteTopic[]> = {
      food: [],
      relationship: [],
      work: [],
      imagination: [],
    };

    sortedTopics.forEach((topic) => {
      grouped[categorizeTopic(topic)].push(topic);
    });

    return grouped;
  }, [sortedTopics]);
  const filteredTopics = useMemo(
    () => (activeTopicTab === 'all' ? sortedTopics : topicsByCategory[activeTopicTab]),
    [activeTopicTab, sortedTopics, topicsByCategory],
  );
  const topicListBottomInset = useMemo(() => 'calc(env(safe-area-inset-bottom) + 8px)', []);
  const mapRegionLevelToggleAlign = useMemo<'left' | 'right'>(() => (isDesktopViewport ? 'left' : 'right'), [isDesktopViewport]);
  const mapBottomDockHeightPx = useMemo(() => (isDesktopViewport ? 0 : 132), [isDesktopViewport]);
  const mapToggleClearancePx = useMemo(() => (isDesktopViewport ? 22 : 14), [isDesktopViewport]);

  useEffect(() => {
    if (!expandedPickerTopicId) {
      return;
    }
    const stillVisible = filteredTopics.some((topic) => topic.id === expandedPickerTopicId);
    if (!stillVisible) {
      setExpandedPickerTopicId(null);
      setPickerSelectedOptionKey(null);
      setPickerVoteMessage(null);
    }
  }, [expandedPickerTopicId, filteredTopics]);

  useEffect(() => {
    if (isDesktopViewport || !selectedRegion || isIntroSheetOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const panel = selectedRegionPanelRef.current;
      const target = event.target;
      if (!panel || !(target instanceof Node)) {
        return;
      }
      if (panel.contains(target)) {
        return;
      }
      setSelectedRegion(null);
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [isDesktopViewport, isIntroSheetOpen, selectedRegion]);

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

  const handleKakaoShare = useCallback(async () => {
    if (!data || typeof window === 'undefined') {
      return;
    }

    const shareUrl = window.location.href;
    const kakao = (window as Window & { Kakao?: unknown }).Kakao as
      | {
          isInitialized?: () => boolean;
          Share?: {
            sendDefault?: (payload: unknown) => void;
          };
        }
      | undefined;

    if (kakao?.isInitialized?.() && kakao.Share?.sendDefault) {
      try {
        kakao.Share.sendDefault({
          objectType: 'feed',
          content: {
            title: data.topic.title,
            description: shareText,
            link: {
              mobileWebUrl: shareUrl,
              webUrl: shareUrl,
            },
          },
          buttons: [
            {
              title: '투표하러 가기',
              link: {
                mobileWebUrl: shareUrl,
                webUrl: shareUrl,
              },
            },
          ],
        });
        showNotice('카카오톡 공유창을 열었어요.');
        return;
      } catch {
        // fallback to web share/copy
      }
    }

    await handleInstantShare();
  }, [data, handleInstantShare, shareText, showNotice]);

  const handleCopyShareLink = useCallback(async () => {
    if (!data || typeof window === 'undefined') {
      return;
    }

    const sharePayload = `${shareText}\n👉 ${window.location.href}`;
    try {
      await navigator.clipboard.writeText(sharePayload);
      showNotice('링크를 복사했어요.');
    } catch {
      showNotice('링크 복사에 실패했어요.');
    }
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
      showNotice('지역 데이터 수집 중이라 전국 지도로 이동했어요.');
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
      showNotice('지역 좌표를 찾지 못해 전국 지도로 이동했어요.');
      return;
    }

    setMapViewRequest({
      id: `view-${Date.now()}`,
      center: [data.myRegion.centroid.lng, data.myRegion.centroid.lat],
      zoom: data.myRegion.level === 'sigungu' ? 8.6 : 7.4,
      reason: 'my-region-focus',
    });
  }, [closeIntroSheet, data, showNotice]);

  const loadPickerTopics = useCallback(async () => {
    setIsTopicsLoading(true);
    setTopicsError(null);
    try {
      const response = await fetch('/api/votes/topics?status=LIVE', { cache: 'no-store' });
      const json = (await response.json()) as { topics?: VoteTopic[]; error?: string };
      if (!response.ok) {
        setTopicsError(json.error ?? '주제 목록을 불러오지 못했습니다.');
        setAvailableTopics([]);
        return;
      }

      setAvailableTopics(json.topics ?? []);
      setTopicsError(null);
    } catch {
      setTopicsError('주제 목록을 불러오지 못했습니다.');
      setAvailableTopics([]);
    } finally {
      setIsTopicsLoading(false);
    }
  }, []);

  const handleSelectNextTopic = useCallback(
    (nextTopicId: string) => {
      if (!nextTopicId || nextTopicId === topicId) {
        return;
      }
      setIsBottomSheetExpanded(false);
      setIsIntroSheetOpen(false);
      setExpandedPickerTopicId(null);
      setPickerSelectedOptionKey(null);
      setPickerVoteMessage(null);
      router.push(`/results/${nextTopicId}`);
    },
    [router, topicId],
  );

  const handleToggleBottomSheet = useCallback(() => {
    setIsBottomSheetExpanded((prev) => !prev);
  }, []);

  const handleOpenNextTopicsFromModal = useCallback(() => {
    setIsIntroSheetOpen(false);
    if (isDesktopViewport) {
      setIsDesktopLeftPanelOpen(true);
      setIsBottomSheetExpanded(false);
    } else {
      setIsBottomSheetExpanded(true);
    }
    void loadPickerTopics();
  }, [isDesktopViewport, loadPickerTopics]);

  const handleTopicPickerToggle = useCallback((nextTopicId: string) => {
    setExpandedPickerTopicId((prev) => (prev === nextTopicId ? null : nextTopicId));
    setPickerSelectedOptionKey(null);
    setPickerVoteMessage(null);
  }, []);

  const handleTopicPickerVoteSubmit = useCallback(
    (topic: VoteTopic) => {
      const optionA = topic.options.find((option) => option.position === 1) ?? null;
      const optionB = topic.options.find((option) => option.position === 2) ?? null;
      if (!optionA || !optionB) {
        setPickerVoteMessage('이 주제는 선택지 구성이 올바르지 않습니다.');
        return;
      }
      if (!pickerSelectedOptionKey) {
        setPickerVoteMessage('먼저 선택지를 선택해 주세요.');
        return;
      }
      setPickerVoteMessage(null);
      handleSelectNextTopic(topic.id);
    },
    [handleSelectNextTopic, pickerSelectedOptionKey],
  );

  const handleLoginClick = useCallback(() => {
    closeIntroSheet();
    router.push('/auth');
  }, [closeIntroSheet, router]);

  useEffect(() => {
    setIsBottomSheetExpanded(false);
    setExpandedPickerTopicId(null);
    setPickerSelectedOptionKey(null);
    setPickerVoteMessage(null);
    setActiveTopicTab('all');
    hasAutoOpenedIntroRef.current = false;
  }, [entryMode, topicId]);

  useEffect(() => {
    if (isTopicsLoading || availableTopics.length > 0 || topicsError) {
      return;
    }
    void loadPickerTopics();
  }, [availableTopics.length, isTopicsLoading, loadPickerTopics, topicsError]);

  useEffect(() => {
    if (!isBottomSheetExpanded) {
      return;
    }

    const handleWindowClick = (event: MouseEvent) => {
      const sheet = openSheetRef.current;
      const target = event.target;
      if (!sheet || !(target instanceof Node)) {
        return;
      }
      if (sheet.contains(target)) {
        return;
      }
      setIsBottomSheetExpanded(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsBottomSheetExpanded(false);
      }
    };

    window.addEventListener('click', handleWindowClick, true);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('click', handleWindowClick, true);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isBottomSheetExpanded]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const syncViewport = () => {
      setIsDesktopViewport(mediaQuery.matches);
    };

    syncViewport();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncViewport);
      return () => mediaQuery.removeEventListener('change', syncViewport);
    }

    mediaQuery.addListener(syncViewport);
    return () => mediaQuery.removeListener(syncViewport);
  }, []);

  useEffect(() => {
    if (isDesktopViewport) {
      setIsBottomSheetExpanded(false);
      setSelectedRegion(null);
    }
  }, [isDesktopViewport]);

  const bottomSheetY = isBottomSheetExpanded ? 0 : 'calc(100% - 124px)';
  const bottomSheetTransition = shouldReduceMotion
    ? { duration: 0 }
    : isBottomSheetExpanded
      ? { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.82 }
      : { duration: 0.18, ease: [0.32, 0.72, 0, 1] as const };
  const bottomSheetBodyTransition = shouldReduceMotion ? { duration: 0.12 } : { duration: 0.16 };

  return (
    <main className="relative min-h-[100dvh] w-full overflow-x-hidden overflow-y-auto bg-black text-white touch-manipulation [font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text','SF_Pro_Display','Segoe_UI',sans-serif]">
      <div className="relative h-[100dvh] w-full">
        <div className="absolute inset-0">
          <KoreaAdminMap
            key={`${topicId}-${Object.keys(mapStats).length}`}
            statsByCode={mapStats}
            defaultRegionLevel="sigungu"
            height="100%"
            initialCenter={DEFAULT_MAP_CENTER}
            initialZoom={DEFAULT_MAP_ZOOM}
            bottomDockHeightPx={mapBottomDockHeightPx}
            toggleClearancePx={mapToggleClearancePx}
            theme="dark"
            colors={RESULT_MAP_COLORS}
            showNavigationControl={false}
            showTooltip={isDesktopViewport}
            tooltipPinOnClick={isDesktopViewport}
            renderTooltipContent={isDesktopViewport ? renderRegionTooltipContent : undefined}
            showRegionLevelToggle
            regionLevelToggleAlign={mapRegionLevelToggleAlign}
            viewRequest={mapViewRequest}
            onRegionClick={
              isDesktopViewport
                ? undefined
                : (region) =>
                    setSelectedRegion((prev) =>
                      prev && prev.code === region.code && prev.level === region.level ? null : region,
                    )
            }
            className="h-full w-full !rounded-none !border-0"
          />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,_rgba(4,10,18,0.36),_rgba(4,10,18,0.12)_40%,_rgba(4,10,18,0.52))]" />
        <div className="pointer-events-none absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 mix-blend-soft-light" />

        <div className="pointer-events-none relative z-20 mx-auto flex h-full w-full max-w-[min(100vw-2.5rem,1920px)] flex-col px-2 pt-[calc(0.6rem+env(safe-area-inset-top))] pb-[calc(0.65rem+env(safe-area-inset-bottom))] md:px-6 md:pt-0 lg:max-w-none lg:px-0">
          <DesktopTopHeader
            className="pointer-events-auto"
            links={[
              { key: 'home', label: '홈', onClick: () => router.push('/') },
              { key: 'map', label: '지도', onClick: () => router.push('/topics-map') },
              { key: 'game', label: '게임', onClick: () => router.push('/game') },
              { key: 'my', label: 'MY', onClick: () => router.push('/my') },
            ]}
            actions={[{ key: 'open-intro', label: '결과 분석 보기', onClick: () => setIsIntroSheetOpen(true), variant: 'solid' }]}
          />

          {isDesktopViewport ? (
            <div className="relative flex min-h-0 flex-1">
              {isDesktopLeftPanelOpen ? (
                <aside className="pointer-events-auto relative flex w-[420px] min-h-0 shrink-0 flex-col overflow-visible rounded-r-[24px] border border-white/12 bg-[rgba(20,20,24,0.82)] shadow-[4px_0_24px_rgba(0,0,0,0.28)]">
                  <button
                    type="button"
                    onClick={() => setIsDesktopLeftPanelOpen(false)}
                    className="absolute -right-[33px] top-1/2 z-20 inline-flex h-[130px] w-8 -translate-y-1/2 items-center justify-center rounded-r-[16px] border border-l-0 border-white/12 bg-[rgba(20,20,24,0.9)] text-white/72 transition hover:text-white"
                    aria-label="다른 주제 선택 패널 접기"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>

                  <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/10 custom-scrollbar">
                    <div className="border-b border-white/10 px-6 py-4">
                      <h3 className="text-[20px] font-bold tracking-tight text-white">다른 주제 선택</h3>
                      <p className="mt-1 text-[12px] text-white/62">선택하면 바로 해당 결과 페이지로 이동합니다.</p>
                    </div>

                    <div className="border-b border-white/10 px-5 pb-3 pt-4">
                      <div className="hide-scrollbar flex gap-2 overflow-x-auto">
                        {TOPIC_TAB_META.map((tab) => {
                          const isActive = activeTopicTab === tab.id;
                          return (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setActiveTopicTab(tab.id)}
                              className={`shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition ${
                                isActive
                                  ? 'border-[#ff9f0a66] bg-[#ff9f0a2b] text-[#ffd29c]'
                                  : 'border-white/15 bg-white/5 text-white/72 hover:bg-white/10 hover:text-white'
                              }`}
                            >
                              {tab.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="px-5 pb-5 pt-4">
                      {isTopicsLoading ? (
                        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white/70">
                          주제 불러오는 중...
                        </div>
                      ) : availableTopics.length === 0 ? (
                        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white/70">
                          LIVE 주제가 없습니다.
                        </div>
                      ) : (
                        <>
                          {topicsError ? <p className="mb-2 text-xs text-[#ffb4b4]">{topicsError}</p> : null}

                          {filteredTopics.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-white/20 bg-white/5 px-3 py-3 text-sm text-white/65">
                              이 카테고리에 표시할 주제가 없습니다.
                            </div>
                          ) : (
                            <div className="space-y-2 pb-1">
                              {filteredTopics.map((topic) => {
                                const optionA = topic.options.find((option) => option.position === 1) ?? null;
                                const optionB = topic.options.find((option) => option.position === 2) ?? null;
                                const isExpanded = expandedPickerTopicId === topic.id;
                                const isSelectionReady = Boolean(pickerSelectedOptionKey && optionA && optionB);

                                return (
                                  <div
                                    key={topic.id}
                                    className={`rounded-xl border bg-white/5 transition-colors duration-300 ${
                                      isExpanded ? 'border-[#ff9f0a55] bg-white/[0.07]' : 'border-white/14'
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => handleTopicPickerToggle(topic.id)}
                                      className="flex h-11 w-full items-center justify-between gap-3 px-3 text-left text-white/84 transition hover:bg-white/6"
                                    >
                                      <p className="line-clamp-1 text-[14px] font-medium leading-5">{topic.title}</p>
                                      <span className="inline-flex h-6 shrink-0 items-center justify-center rounded-full border border-[#ff9f0a55] bg-[#ff9f0a26] px-2 text-[11px] font-semibold text-[#ffd2a6]">
                                        {isExpanded ? '닫기' : '투표'}
                                      </span>
                                    </button>

                                    <div
                                      className={`overflow-hidden transition-[max-height,opacity,transform] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] ${
                                        isExpanded
                                          ? 'max-h-[320px] translate-y-0 opacity-100'
                                          : 'pointer-events-none -translate-y-1 max-h-0 opacity-0'
                                      }`}
                                    >
                                      <div className="border-t border-white/6 px-3 pb-3 pt-2.5">
                                        <p className="text-[12px] text-white/66">선택지를 고르고 바로 투표하세요.</p>
                                        {optionA && optionB ? (
                                          <>
                                            <div className="mt-2 grid grid-cols-2 gap-2">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setPickerSelectedOptionKey(optionA.key);
                                                  setPickerVoteMessage(null);
                                                }}
                                                className={`inline-flex h-11 items-center justify-center rounded-xl border px-2 text-[13px] font-semibold transition ${
                                                  pickerSelectedOptionKey === optionA.key
                                                    ? 'border-[#ff9f0a88] bg-[#ff6b0030] text-[#ffd9b0]'
                                                    : 'border-white/14 bg-white/4 text-white/78 hover:bg-white/10'
                                                }`}
                                              >
                                                {optionA.label}
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setPickerSelectedOptionKey(optionB.key);
                                                  setPickerVoteMessage(null);
                                                }}
                                                className={`inline-flex h-11 items-center justify-center rounded-xl border px-2 text-[13px] font-semibold transition ${
                                                  pickerSelectedOptionKey === optionB.key
                                                    ? 'border-[#4ea1ff88] bg-[#2f7cff2e] text-[#cfe2ff]'
                                                    : 'border-white/14 bg-white/4 text-white/78 hover:bg-white/10'
                                                }`}
                                              >
                                                {optionB.label}
                                              </button>
                                            </div>
                                            {pickerVoteMessage ? <p className="mt-2 text-xs text-[#ffd0a6]">{pickerVoteMessage}</p> : null}
                                            <button
                                              type="button"
                                              onClick={() => handleTopicPickerVoteSubmit(topic)}
                                              disabled={!isSelectionReady}
                                              className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-xl border border-[#ff9f0a66] bg-[#ff6b00] text-[13px] font-bold text-white transition hover:bg-[#ff7b1d] disabled:cursor-not-allowed disabled:border-white/20 disabled:bg-white/10 disabled:text-white/45"
                                            >
                                              투표 후 결과 보기
                                            </button>
                                          </>
                                        ) : (
                                          <p className="mt-2 text-xs text-[#ffb4b4]">이 주제는 선택지 정보를 불러오지 못했습니다.</p>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </aside>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsDesktopLeftPanelOpen(true)}
                  className="pointer-events-auto absolute left-0 top-1/2 z-20 inline-flex h-[130px] w-8 -translate-y-1/2 items-center justify-center rounded-r-[16px] border border-l-0 border-white/12 bg-[rgba(20,20,24,0.9)] text-white/72 transition hover:text-white"
                  aria-label="다른 주제 선택 패널 열기"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              )}

              <div className="ml-auto flex min-h-0 w-full max-w-[clamp(320px,28vw,460px)] flex-col gap-3 px-3 pb-4 pt-3 lg:pr-8">
                {data && !isIntroSheetOpen ? (
                  <section className="pointer-events-auto relative overflow-hidden rounded-[18px] border border-white/16 bg-[linear-gradient(145deg,rgba(14,24,40,0.92),rgba(12,18,28,0.78))] p-3.5 shadow-[0_10px_26px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
                    <div className="pointer-events-none absolute -left-7 -top-8 h-20 w-20 rounded-full bg-[#ff6b002e] blur-2xl" />
                    <div className="pointer-events-none absolute -bottom-8 -right-8 h-24 w-24 rounded-full bg-[#2f74ff2e] blur-2xl" />

                    <div className="relative flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/56">전국 실시간 판세</p>
                        <p className="mt-1 line-clamp-1 text-[14px] font-semibold text-white">{data.topic.title}</p>
                        <p className="mt-1 text-xs text-white/72">
                          총 <span className="font-bold text-white">{data.nationwide.totalVotes.toLocaleString()}표</span> 참여
                        </p>
                      </div>

                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#70b5ff66] bg-[#2f74ff24] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#b6d4ff]">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7bc2ff] opacity-80" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#7bc2ff]" />
                        </span>
                        Live
                      </span>
                    </div>

                    <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-semibold text-[#ffd3ae]">{data.topic.optionA.label}</p>
                        <p className="text-[19px] font-black leading-none text-[#ffad63]">{nationwideBar.a}%</p>
                      </div>
                      <span className="pb-0.5 text-[10px] font-semibold text-white/42">VS</span>
                      <div className="min-w-0 text-right">
                        <p className="truncate text-[11px] font-semibold text-[#c3dcff]">{data.topic.optionB.label}</p>
                        <p className="text-[19px] font-black leading-none text-[#8dbdff]">{nationwideBar.b}%</p>
                      </div>
                    </div>

                    <div className="relative mt-2.5">
                      <div className="flex h-3 overflow-hidden rounded-full bg-white/12 ring-1 ring-white/12">
                        <div
                          className="h-full bg-[linear-gradient(90deg,#ff6b00,#ff9f0a)] transition-[width] duration-700 ease-out"
                          style={{ width: `${nationwideBar.displayA}%` }}
                        />
                        <div
                          className="h-full bg-[linear-gradient(90deg,#2f74ff,#63a6ff)] transition-[width] duration-700 ease-out"
                          style={{ width: `${nationwideBar.displayB}%` }}
                        />
                      </div>
                      <div className="pointer-events-none absolute inset-0 rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0.18),rgba(255,255,255,0.02))] mix-blend-screen opacity-35" />
                    </div>

                    <p className="mt-2 text-[11px] font-semibold text-white/76">
                      {nationwideBar.winner === 'TIE'
                        ? '현재 전국 판세가 팽팽해요.'
                        : `${nationwideBar.winner === 'A' ? data.topic.optionA.label : data.topic.optionB.label} ${nationwideBar.gap}%p 우세`}
                    </p>
                  </section>
                ) : null}

                {noticeMessage && !isIntroSheetOpen ? (
                  <div className="pointer-events-none rounded-xl border border-white/18 bg-[rgba(14,18,28,0.72)] px-3 py-2 text-center text-xs font-medium text-white/86 backdrop-blur-xl">
                    {noticeMessage}
                  </div>
                ) : null}

                {isLoading ? (
                  <section className="pointer-events-auto space-y-3 rounded-[24px] border border-white/14 bg-[rgba(18,20,28,0.76)] p-4 shadow-[0_10px_28px_rgba(0,0,0,0.34)] backdrop-blur-2xl">
                    <div className="h-5 w-44 animate-pulse rounded bg-white/14" />
                    <div className="h-4 w-64 animate-pulse rounded bg-white/12" />
                    <div className="h-20 animate-pulse rounded-2xl bg-white/10" />
                    <div className="h-20 animate-pulse rounded-2xl bg-white/10" />
                  </section>
                ) : error ? (
                  <section className="pointer-events-auto rounded-[24px] border border-white/14 bg-[rgba(18,20,28,0.78)] p-4 shadow-[0_10px_28px_rgba(0,0,0,0.34)] backdrop-blur-2xl">
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
                ) : null}
              </div>
            </div>
          ) : (
            <>
              {data && !isIntroSheetOpen ? (
                <section className="pointer-events-auto absolute left-1/2 top-[calc(0.8rem+env(safe-area-inset-top))] z-10 w-[calc(100%-1.5rem)] max-w-[560px] -translate-x-1/2 overflow-hidden rounded-[18px] border border-white/16 bg-[linear-gradient(145deg,rgba(14,24,40,0.92),rgba(12,18,28,0.78))] p-3.5 shadow-[0_10px_26px_rgba(0,0,0,0.32)] backdrop-blur-2xl md:top-[5.2rem] lg:max-w-[min(46vw,760px)]">
                  <div className="pointer-events-none absolute -left-7 -top-8 h-20 w-20 rounded-full bg-[#ff6b002e] blur-2xl" />
                  <div className="pointer-events-none absolute -bottom-8 -right-8 h-24 w-24 rounded-full bg-[#2f74ff2e] blur-2xl" />

                  <div className="relative flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/56">전국 실시간 판세</p>
                      <p className="mt-1 line-clamp-1 text-[14px] font-semibold text-white">{data.topic.title}</p>
                      <p className="mt-1 text-xs text-white/72">
                        총 <span className="font-bold text-white">{data.nationwide.totalVotes.toLocaleString()}표</span> 참여
                      </p>
                    </div>

                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#70b5ff66] bg-[#2f74ff24] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#b6d4ff]">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7bc2ff] opacity-80" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#7bc2ff]" />
                      </span>
                      Live
                    </span>
                  </div>

                  <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-semibold text-[#ffd3ae]">{data.topic.optionA.label}</p>
                      <p className="text-[19px] font-black leading-none text-[#ffad63]">{nationwideBar.a}%</p>
                    </div>
                    <span className="pb-0.5 text-[10px] font-semibold text-white/42">VS</span>
                    <div className="min-w-0 text-right">
                      <p className="truncate text-[11px] font-semibold text-[#c3dcff]">{data.topic.optionB.label}</p>
                      <p className="text-[19px] font-black leading-none text-[#8dbdff]">{nationwideBar.b}%</p>
                    </div>
                  </div>

                  <div className="relative mt-2.5">
                    <div className="flex h-3 overflow-hidden rounded-full bg-white/12 ring-1 ring-white/12">
                      <div
                        className="h-full bg-[linear-gradient(90deg,#ff6b00,#ff9f0a)] transition-[width] duration-700 ease-out"
                        style={{ width: `${nationwideBar.displayA}%` }}
                      />
                      <div
                        className="h-full bg-[linear-gradient(90deg,#2f74ff,#63a6ff)] transition-[width] duration-700 ease-out"
                        style={{ width: `${nationwideBar.displayB}%` }}
                      />
                    </div>
                    <div className="pointer-events-none absolute inset-0 rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0.18),rgba(255,255,255,0.02))] mix-blend-screen opacity-35" />
                  </div>

                  <p className="mt-2 text-[11px] font-semibold text-white/76">
                    {nationwideBar.winner === 'TIE'
                      ? '현재 전국 판세가 팽팽해요.'
                      : `${nationwideBar.winner === 'A' ? data.topic.optionA.label : data.topic.optionB.label} ${nationwideBar.gap}%p 우세`}
                  </p>
                </section>
              ) : null}

              {data && selectedRegion && !isIntroSheetOpen ? (
                <section
                  ref={selectedRegionPanelRef}
                  className="pointer-events-auto absolute left-1/2 top-[calc(8.8rem+env(safe-area-inset-top))] z-10 w-[calc(100%-1.5rem)] max-w-[560px] -translate-x-1/2 rounded-[20px] border border-white/14 bg-[rgba(12,18,28,0.72)] p-3.5 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-2xl md:top-[13rem] lg:max-w-[min(46vw,760px)]"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="truncate pr-2 text-[15px] font-semibold text-white">{selectedRegion.name || selectedRegion.code}</h4>
                    <span className="rounded-full border border-white/18 bg-white/8 px-2.5 py-1 text-[11px] font-semibold text-white/75">
                      {selectedRegion.level === 'sido' ? '시/도' : '시/군/구'}
                    </span>
                  </div>

                  {selectedRegionBreakdown ? (
                    <>
                      <p className="mt-2 text-[12px] text-white/68">
                        누적 투표수 <span className="font-semibold text-white">{selectedRegionBreakdown.total.toLocaleString()}표</span>
                      </p>
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
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-white/62">투표 데이터가 아직 없습니다.</p>
                  )}
                </section>
              ) : null}

              {noticeMessage && !isIntroSheetOpen ? (
                <div className="pointer-events-none absolute left-1/2 top-[calc(12.4rem+env(safe-area-inset-top))] z-20 w-[calc(100%-1.5rem)] max-w-[560px] -translate-x-1/2 rounded-xl border border-white/18 bg-[rgba(14,18,28,0.72)] px-3 py-2 text-center text-xs font-medium text-white/86 backdrop-blur-xl md:top-[16.4rem] lg:max-w-[min(46vw,760px)]">
                  {noticeMessage}
                </div>
              ) : null}

              {isLoading ? (
                <section className="pointer-events-auto absolute left-1/2 bottom-[calc(0.65rem+env(safe-area-inset-bottom))] w-[calc(100%-1.5rem)] max-w-[560px] -translate-x-1/2 space-y-3 rounded-[24px] border border-white/14 bg-[rgba(18,20,28,0.76)] p-4 shadow-[0_10px_28px_rgba(0,0,0,0.34)] backdrop-blur-2xl lg:max-w-[min(46vw,760px)]">
                  <div className="h-5 w-44 animate-pulse rounded bg-white/14" />
                  <div className="h-4 w-64 animate-pulse rounded bg-white/12" />
                  <div className="h-20 animate-pulse rounded-2xl bg-white/10" />
                  <div className="h-20 animate-pulse rounded-2xl bg-white/10" />
                </section>
              ) : error ? (
                <section className="pointer-events-auto absolute left-1/2 bottom-[calc(0.65rem+env(safe-area-inset-bottom))] w-[calc(100%-1.5rem)] max-w-[560px] -translate-x-1/2 rounded-[24px] border border-white/14 bg-[rgba(18,20,28,0.78)] p-4 shadow-[0_10px_28px_rgba(0,0,0,0.34)] backdrop-blur-2xl lg:max-w-[min(46vw,760px)]">
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
              ) : null}
            </>
          )}
        </div>
      </div>

      {data && !isIntroSheetOpen ? (
        <motion.section
          ref={openSheetRef}
          initial={false}
          animate={{ y: bottomSheetY }}
          transition={bottomSheetTransition}
          className={`pointer-events-auto fixed bottom-[calc(0.65rem+env(safe-area-inset-bottom))] left-1/2 z-30 h-[min(76dvh,620px)] w-[calc(100%-1.5rem)] max-w-[560px] -translate-x-1/2 rounded-t-[24px] rounded-b-[20px] border border-white/8 bg-[rgba(12,18,28,0.84)] shadow-[0_6px_16px_rgba(0,0,0,0.2)] backdrop-blur-2xl lg:hidden ${
            isBottomSheetExpanded ? 'overflow-y-auto' : 'overflow-hidden'
          }`}
          style={{
            WebkitOverflowScrolling: isBottomSheetExpanded ? 'touch' : undefined,
            overscrollBehavior: isBottomSheetExpanded ? 'contain' : undefined,
            scrollPaddingBottom: topicListBottomInset,
          }}
        >
          <button
            type="button"
            onClick={handleToggleBottomSheet}
            className="sticky top-0 z-10 w-full border-b border-white/6 bg-[rgba(12,18,28,0.94)] px-4 pb-1.5 pt-2 text-center backdrop-blur-xl"
            aria-expanded={isBottomSheetExpanded}
            aria-label={isBottomSheetExpanded ? '다른 주제 선택 시트 닫기' : '다른 주제 선택 시트 열기'}
          >
            <div className="mx-auto h-1.5 w-12 rounded-full bg-white/28" />
            <p className="mt-1.5 text-[12px] font-semibold tracking-[-0.01em] text-white/70">눌러서 다른 주제에 투표하세요</p>
          </button>

          <div className="px-4 pb-2.5 pt-1.5">
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => setIsIntroSheetOpen(true)}
                className="inline-flex h-9 min-w-[44px] items-center justify-center rounded-lg border border-white/16 bg-white/[0.06] px-2 text-[13px] font-semibold text-white/90 transition hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/45"
              >
                분석
              </button>
              <button
                type="button"
                onClick={() => router.push('/')}
                className="inline-flex h-9 min-w-[44px] items-center justify-center rounded-lg border border-white/16 bg-white/[0.06] px-2 text-[13px] font-semibold text-white/90 transition hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/45"
              >
                홈
              </button>
              <button
                type="button"
                onClick={() => router.push('/topics-map')}
                className="inline-flex h-9 min-w-[44px] items-center justify-center rounded-lg border border-white/16 bg-white/[0.06] px-2 text-[13px] font-semibold text-white/90 transition hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/45"
              >
                지도
              </button>
            </div>
          </div>

          <motion.div
            initial={false}
            animate={{ opacity: isBottomSheetExpanded ? 1 : 0 }}
            transition={bottomSheetBodyTransition}
            className={isBottomSheetExpanded ? 'pointer-events-auto' : 'pointer-events-none'}
            aria-hidden={!isBottomSheetExpanded}
          >
            <div className="border-t border-white/6 px-5 pb-3 pt-4">
              <h4 className="text-[20px] font-semibold text-white">다른 주제 선택</h4>
              <p className="mt-1 text-xs text-white/60">선택하면 바로 투표 카드가 펼쳐집니다.</p>
            </div>

            <div className="px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
              {isTopicsLoading ? (
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white/70">
                  주제 불러오는 중...
                </div>
              ) : availableTopics.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white/70">
                  LIVE 주제가 없습니다.
                </div>
              ) : (
                <>
                  <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
                    {TOPIC_TAB_META.map((tab) => {
                      const isActive = activeTopicTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setActiveTopicTab(tab.id)}
                          className={`shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition ${
                            isActive
                              ? 'border-[#ff9f0a66] bg-[#ff9f0a2b] text-[#ffd29c]'
                              : 'border-white/15 bg-white/5 text-white/72 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>

                  {topicsError ? <p className="mb-2 text-xs text-[#ffb4b4]">{topicsError}</p> : null}

                  {filteredTopics.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/20 bg-white/5 px-3 py-3 text-sm text-white/65">
                      이 카테고리에 표시할 주제가 없습니다.
                    </div>
                  ) : (
                    <div className="space-y-2 pb-1">
                      {filteredTopics.map((topic) => {
                        const optionA = topic.options.find((option) => option.position === 1) ?? null;
                        const optionB = topic.options.find((option) => option.position === 2) ?? null;
                        const isExpanded = expandedPickerTopicId === topic.id;
                        const isSelectionReady = Boolean(pickerSelectedOptionKey && optionA && optionB);

                        return (
                          <div
                            key={topic.id}
                            className={`rounded-xl border bg-white/5 transition-colors duration-300 ${
                              isExpanded ? 'border-[#ff9f0a55] bg-white/[0.07]' : 'border-white/14'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => handleTopicPickerToggle(topic.id)}
                              className="flex h-11 w-full items-center justify-between gap-3 px-3 text-left text-white/84 transition hover:bg-white/6"
                            >
                              <p className="line-clamp-1 text-[14px] font-medium leading-5">{topic.title}</p>
                              <span className="inline-flex h-6 shrink-0 items-center justify-center rounded-full border border-[#ff9f0a55] bg-[#ff9f0a26] px-2 text-[11px] font-semibold text-[#ffd2a6]">
                                {isExpanded ? '닫기' : '투표'}
                              </span>
                            </button>

                            <div
                              className={`overflow-hidden transition-[max-height,opacity,transform] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] ${
                                isExpanded ? 'max-h-[320px] translate-y-0 opacity-100' : 'pointer-events-none -translate-y-1 max-h-0 opacity-0'
                              }`}
                            >
                              <div className="border-t border-white/6 px-3 pb-3 pt-2.5">
                                <p className="text-[12px] text-white/66">선택지를 고르고 바로 투표하세요.</p>
                                {optionA && optionB ? (
                                  <>
                                    <div className="mt-2 grid grid-cols-2 gap-2">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setPickerSelectedOptionKey(optionA.key);
                                          setPickerVoteMessage(null);
                                        }}
                                        className={`inline-flex h-11 items-center justify-center rounded-xl border px-2 text-[13px] font-semibold transition ${
                                          pickerSelectedOptionKey === optionA.key
                                            ? 'border-[#ff9f0a88] bg-[#ff6b0030] text-[#ffd9b0]'
                                            : 'border-white/14 bg-white/4 text-white/78 hover:bg-white/10'
                                        }`}
                                      >
                                        {optionA.label}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setPickerSelectedOptionKey(optionB.key);
                                          setPickerVoteMessage(null);
                                        }}
                                        className={`inline-flex h-11 items-center justify-center rounded-xl border px-2 text-[13px] font-semibold transition ${
                                          pickerSelectedOptionKey === optionB.key
                                            ? 'border-[#4ea1ff88] bg-[#2f7cff2e] text-[#cfe2ff]'
                                            : 'border-white/14 bg-white/4 text-white/78 hover:bg-white/10'
                                        }`}
                                      >
                                        {optionB.label}
                                      </button>
                                    </div>
                                    {pickerVoteMessage ? <p className="mt-2 text-xs text-[#ffd0a6]">{pickerVoteMessage}</p> : null}
                                    <button
                                      type="button"
                                      onClick={() => handleTopicPickerVoteSubmit(topic)}
                                      disabled={!isSelectionReady}
                                      className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-xl border border-[#ff9f0a66] bg-[#ff6b00] text-[13px] font-bold text-white transition hover:bg-[#ff7b1d] disabled:cursor-not-allowed disabled:border-white/20 disabled:bg-white/10 disabled:text-white/45"
                                    >
                                      투표 후 결과 보기
                                    </button>
                                  </>
                                ) : (
                                  <p className="mt-2 text-xs text-[#ffb4b4]">이 주제는 선택지 정보를 불러오지 못했습니다.</p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.section>
      ) : null}

      {data && !isIntroSheetOpen ? (
        <footer className="relative z-50 border-t border-white/8 bg-[rgba(10,14,22,0.985)]">
          <div
            className="mx-auto w-full max-w-[min(100vw-2.5rem,1920px)] px-4 pb-4 pt-6 text-white/72 md:flex md:items-start md:justify-between md:gap-6 md:px-8 lg:px-10"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
          >
            <div>
              <p className="text-sm font-semibold text-white/88">Vote War Map</p>
              <p className="mt-2 text-xs text-white/60">© 2026 Vote War Map. All rights reserved.</p>
            </div>
            <p className="mt-2 text-xs text-white/55 md:mt-0 md:max-w-[360px] md:text-right">
              문의/정책 안내 페이지는 추후 업데이트될 예정입니다.
            </p>
          </div>
        </footer>
      ) : null}

      {data ? (
        <VoteResultModal
          isOpen={isIntroSheetOpen}
          onClose={closeIntroSheet}
          topicId={data.topic.id}
          topicTitle={data.topic.title}
          myChoice={myChoiceSide}
          optionA={{
            label: data.topic.optionA.label,
            percent: data.nationwide.aPercent,
            count: data.nationwide.countA,
          }}
          optionB={{
            label: data.topic.optionB.label,
            percent: data.nationwide.bPercent,
            count: data.nationwide.countB,
          }}
          totalVotes={data.nationwide.totalVotes}
          myRegion={
            data.myRegion
              ? {
                  name: data.myRegion.name,
                  percentA: data.myRegion.aPercent,
                  percentB: data.myRegion.bPercent,
                }
              : null
          }
          onMapView={handleMapView}
          onShareKakao={handleKakaoShare}
          onShareLinkCopy={handleCopyShareLink}
          onOpenNextTopics={handleOpenNextTopicsFromModal}
          reducedMotion={Boolean(shouldReduceMotion)}
          isAuthenticated={isAuthenticated}
          onLoginClick={handleLoginClick}
        />
      ) : null}
    </main>
  );
}
