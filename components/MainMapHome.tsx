'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent, type WheelEvent } from 'react';
import type { MapPointMarker, RegionVoteMap } from '@/components/KoreaAdminMap';
import { LiveVoteCard } from '@/components/vote/LiveVoteCard';
import { useAuth } from '@/contexts/AuthContext';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  addPendingVoteTopic,
  readPendingProfile,
  readPendingVotes,
  writePendingProfile,
} from '@/lib/vote/client-storage';
import { useGuestSessionHeartbeat } from '@/lib/vote/guest-session';
import { LOCAL_STORAGE_KEYS } from '@/lib/vote/constants';
import { getOptionSubtext } from '@/lib/vote/option-subtext-map';
import type { Gender, SchoolSearchItem, VoteProfileInput, VoteTopic } from '@/lib/vote/types';

const KoreaAdminMap = dynamic(() => import('@/components/KoreaAdminMap'), { ssr: false });

const MAIN_INITIAL_CENTER: [number, number] = [127.75, 36.18];
const MAIN_INITIAL_ZOOM = 6.0;
const MAIN_MAP_COLORS = {
  a: 'rgba(255, 90, 0, 0.95)',
  b: 'rgba(30, 120, 255, 0.95)',
  tie: 'rgba(255, 193, 63, 0.95)',
  neutral: 'rgba(42, 34, 30, 0.18)',
} as const;
const DOCK_SCROLL_TOUCH_THRESHOLD_PX = 8;
const HOME_MAP_CACHE_KEY = 'all-live-topics';
const GENDER_OPTIONS: Array<{ value: Gender; label: string }> = [
  { value: 'male', label: '남성' },
  { value: 'female', label: '여성' },
];

type TopicCategory = 'food' | 'relationship' | 'work' | 'imagination';
type TopicTab = 'all' | TopicCategory;
type FeaturedTopicMetrics = {
  totalVotes: number;
  realtimeVotes: number;
  score: number;
  lastVoteAt: string | null;
};

type FeaturedResultSummaryResponse = {
  viewer?: {
    hasVote?: boolean;
  };
  myChoice?: {
    optionKey?: string | null;
  } | null;
};

type RegionHotTopic = {
  topicId: string;
  title: string;
  status: string;
  voteCount: number;
  lastVoteAt: string;
};

type RegionHotTopicsResponse = {
  level: 'sido' | 'sigungu';
  code: string;
  topics?: RegionHotTopic[];
  error?: string;
};

type CachedRegionStatePayload = {
  cacheKey: string;
  statsByCode: RegionVoteMap;
};

type PendingTopicPickerVote = {
  topicId: string;
  optionKey: string;
  optionAKey: string;
  optionBKey: string;
};

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

function normalizeSummary(summary: {
  totalVotes: number;
  countA: number;
  countB: number;
}): {
  totalVotes: number;
  countA: number;
  countB: number;
  aPercent: number;
  bPercent: number;
  hasData: boolean;
} {
  if (summary.totalVotes <= 0) {
    return {
      totalVotes: 0,
      countA: summary.countA,
      countB: summary.countB,
      aPercent: 0,
      bPercent: 0,
      hasData: false,
    };
  }

  const aPercent = Math.round((summary.countA / summary.totalVotes) * 100);
  const bPercent = Math.max(0, 100 - aPercent);
  return { ...summary, aPercent, bPercent, hasData: true };
}

function bumpRegionStat(
  prev: RegionVoteMap,
  regionCode: string | null | undefined,
  optionKey: string,
  optionAKey: string,
  optionBKey: string,
): RegionVoteMap {
  if (!regionCode) {
    return prev;
  }

  const next = { ...prev };
  const current = next[regionCode] ?? { total: 0, countA: 0, countB: 0, winner: 'TIE' as const };
  const countA = (current.countA ?? 0) + (optionKey === optionAKey ? 1 : 0);
  const countB = (current.countB ?? 0) + (optionKey === optionBKey ? 1 : 0);
  const total = (current.total ?? 0) + 1;
  const winner = countA > countB ? 'A' : countB > countA ? 'B' : 'TIE';

  next[regionCode] = { countA, countB, total, winner };
  return next;
}

function readCachedRegionState(cacheKey: string): CachedRegionStatePayload | null {
  if (!cacheKey) {
    return null;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEYS.cachedRegionStatsPopular);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<CachedRegionStatePayload>;
    if (!parsed.statsByCode || parsed.cacheKey !== cacheKey) {
      return null;
    }

    return {
      cacheKey: String(parsed.cacheKey),
      statsByCode: parsed.statsByCode,
    };
  } catch {
    return null;
  }
}

function writeCachedRegionState(payload: CachedRegionStatePayload): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(LOCAL_STORAGE_KEYS.cachedRegionStatsPopular, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

function normalizeBinaryGender(value: Gender | null | undefined): Gender {
  return value === 'female' ? 'female' : 'male';
}

export default function MainMapHome() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'home' | 'map' | 'rank' | 'me'>('home');
  const [mapStats, setMapStats] = useState<RegionVoteMap>({});
  const [topSchoolMarkers, setTopSchoolMarkers] = useState<MapPointMarker[]>([]);
  const [isStatsLoading, setIsStatsLoading] = useState(true);
  const [summary, setSummary] = useState({
    totalVotes: 0,
    countA: 0,
    countB: 0,
    aPercent: 0,
    bPercent: 0,
    hasData: false,
  });
  const [featuredTopic, setFeaturedTopic] = useState<VoteTopic | null>(null);
  const [featuredMetrics, setFeaturedMetrics] = useState<FeaturedTopicMetrics | null>(null);
  const [isFeaturedLoading, setIsFeaturedLoading] = useState(true);
  const [featuredHasVoted, setFeaturedHasVoted] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [voteMessage, setVoteMessage] = useState<string | null>(null);
  const [isSubmittingVote, setIsSubmittingVote] = useState(false);
  const [isVoteCardCollapsed, setIsVoteCardCollapsed] = useState(true);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [isSchoolSearching, setIsSchoolSearching] = useState(false);
  const [schoolResults, setSchoolResults] = useState<SchoolSearchItem[]>([]);
  const [schoolQuery, setSchoolQuery] = useState('');
  const [highlightedSchoolIndex, setHighlightedSchoolIndex] = useState(0);
  const [birthYear, setBirthYear] = useState<number>(() => new Date().getFullYear() - 17);
  const [gender, setGender] = useState<Gender>('male');
  const [selectedSchool, setSelectedSchool] = useState<SchoolSearchItem | null>(null);
  const [voteAfterProfile, setVoteAfterProfile] = useState(false);
  const [guestHasVoted, setGuestHasVoted] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<{
    code: string;
    name: string;
    level: 'sido' | 'sigungu';
  } | null>(null);
  const [regionHotTopics, setRegionHotTopics] = useState<RegionHotTopic[]>([]);
  const [isRegionHotTopicsLoading, setIsRegionHotTopicsLoading] = useState(false);
  const [regionHotTopicsError, setRegionHotTopicsError] = useState<string | null>(null);
  const [isTopicPickerOpen, setIsTopicPickerOpen] = useState(false);
  const [activeTopicTab, setActiveTopicTab] = useState<TopicTab>('all');
  const [availableTopics, setAvailableTopics] = useState<VoteTopic[]>([]);
  const [isTopicsLoading, setIsTopicsLoading] = useState(false);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [expandedPickerTopicId, setExpandedPickerTopicId] = useState<string | null>(null);
  const [pickerSelectedOptionKey, setPickerSelectedOptionKey] = useState<string | null>(null);
  const [pickerVoteMessage, setPickerVoteMessage] = useState<string | null>(null);
  const [isPickerSubmittingVote, setIsPickerSubmittingVote] = useState(false);
  const [pendingPickerVote, setPendingPickerVote] = useState<PendingTopicPickerVote | null>(null);
  const [bottomAdHeight, setBottomAdHeight] = useState(0);
  const [bottomMenuHeight, setBottomMenuHeight] = useState(0);
  const [topicHintHeight, setTopicHintHeight] = useState(0);
  const [topicHintAnchorPercent, setTopicHintAnchorPercent] = useState(37.5);
  const bottomDockRef = useRef<HTMLDivElement | null>(null);
  const bottomMenuRef = useRef<HTMLDivElement | null>(null);
  const bottomMenuGridRef = useRef<HTMLDivElement | null>(null);
  const mapTabButtonRef = useRef<HTMLButtonElement | null>(null);
  const topicHintRef = useRef<HTMLDivElement | null>(null);
  const selectedRegionPanelRef = useRef<HTMLElement | null>(null);
  const schoolResultsListRef = useRef<HTMLDivElement | null>(null);
  const dockTouchStartYRef = useRef<number | null>(null);
  const dockTouchLastYRef = useRef<number | null>(null);
  const dockTouchMovedRef = useRef(false);
  const bottomDockHeight = useMemo(() => bottomAdHeight + bottomMenuHeight, [bottomAdHeight, bottomMenuHeight]);

  const { isAuthenticated, isLoading, profile, user, signOut } = useAuth();
  const guestSessionId = useGuestSessionHeartbeat({ enabled: !isAuthenticated });
  const hasServerProfile = Boolean(profile?.birth_year && profile?.gender && profile?.school_id);
  const featuredOptionA = useMemo(
    () => featuredTopic?.options.find((option) => option.position === 1) ?? null,
    [featuredTopic],
  );
  const featuredOptionB = useMemo(
    () => featuredTopic?.options.find((option) => option.position === 2) ?? null,
    [featuredTopic],
  );
  const featuredOptionAKey = featuredOptionA?.key ?? null;
  const featuredOptionBKey = featuredOptionB?.key ?? null;
  const featuredOptionALabel = featuredOptionA?.label ?? '선택지 A';
  const featuredOptionBLabel = featuredOptionB?.label ?? '선택지 B';

  const mergedMapStats = useMemo(() => mapStats, [mapStats]);
  const selectedRegionStat = useMemo(() => {
    if (!selectedRegion) {
      return null;
    }
    return mergedMapStats[selectedRegion.code] ?? null;
  }, [mergedMapStats, selectedRegion]);
  const birthYearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const options: Array<{ value: string; label: string }> = [];
    for (let year = currentYear; year >= 1900; year -= 1) {
      options.push({ value: String(year), label: `${year}년` });
    }
    return options;
  }, []);
  const sortedTopics = useMemo(
    () => [...availableTopics].sort((a, b) => KO_TOPIC_COLLATOR.compare(a.title, b.title)),
    [availableTopics],
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
  const filteredTopics = useMemo(() => {
    return activeTopicTab === 'all' ? sortedTopics : topicsByCategory[activeTopicTab];
  }, [activeTopicTab, sortedTopics, topicsByCategory]);
  const isSchoolListVisible = Boolean(
    schoolQuery.trim() && (!selectedSchool || schoolQuery !== selectedSchool.schoolName),
  );
  const hintReservePaddingPx = useMemo(() => {
    if (isTopicPickerOpen) {
      return 0;
    }
    return topicHintHeight > 0 ? topicHintHeight + 8 : 0;
  }, [isTopicPickerOpen, topicHintHeight]);
  const topicListBottomInset = useMemo(() => 'calc(env(safe-area-inset-bottom) + 8px)', []);
  const emptySummary = useMemo(
    () =>
      normalizeSummary({
        totalVotes: 0,
        countA: 0,
        countB: 0,
      }),
    [],
  );

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
    let cancelled = false;

    const run = async () => {
      setIsTopicsLoading(true);
      setTopicsError(null);
      try {
        const response = await fetch('/api/votes/topics?status=LIVE', { cache: 'no-store' });
        const json = (await response.json()) as { topics?: VoteTopic[]; error?: string };
        if (!response.ok) {
          if (!cancelled) {
            setTopicsError(json.error ?? '주제 목록을 불러오지 못했습니다.');
            setAvailableTopics([]);
          }
          return;
        }

        const nextTopics = json.topics ?? [];
        if (cancelled) {
          return;
        }

        setAvailableTopics(nextTopics);
      } catch {
        if (!cancelled) {
          setTopicsError('주제 목록을 불러오지 못했습니다.');
          setAvailableTopics([]);
        }
      } finally {
        if (!cancelled) {
          setIsTopicsLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setIsFeaturedLoading(true);
      try {
        const response = await fetch('/api/votes/featured?status=LIVE', { cache: 'no-store' });
        const json = (await response.json()) as {
          topic?: VoteTopic | null;
          metrics?: FeaturedTopicMetrics;
          error?: string;
        };

        if (!response.ok) {
          if (!cancelled) {
            setVoteMessage(json.error ?? '대표 주제를 불러오지 못했습니다.');
            setFeaturedTopic(null);
            setFeaturedMetrics(null);
            setSelectedOption(null);
          }
          return;
        }

        if (!cancelled) {
          const nextTopic = json.topic ?? null;
          setFeaturedTopic(nextTopic);
          setFeaturedMetrics(json.metrics ?? null);
          setSelectedOption((prev) =>
            prev && nextTopic?.options.some((option) => option.key === prev) ? prev : null,
          );
          if (!nextTopic) {
            setVoteMessage('현재 진행 중인 주제가 없습니다.');
          }
        }
      } catch {
        if (!cancelled) {
          setFeaturedTopic(null);
          setFeaturedMetrics(null);
          setSelectedOption(null);
          setVoteMessage('대표 주제를 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) {
          setIsFeaturedLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  const loadHomeMapStats = useCallback(async () => {
    try {
      const nonce = Date.now();
      const [sidoRes, sigunguRes, topSchoolsRes] = await Promise.allSettled([
        fetch(`/api/votes/region-stats?scope=all&level=sido&ts=${nonce}`, {
          cache: 'no-store',
        }),
        fetch(`/api/votes/region-stats?scope=all&level=sigungu&ts=${nonce}`, {
          cache: 'no-store',
        }),
        fetch('/api/votes/top-schools-by-region?scope=all', { cache: 'no-store' }),
      ]);

      let sidoJson: { statsByCode?: RegionVoteMap } | null = null;
      let sigunguJson: { statsByCode?: RegionVoteMap } | null = null;
      let topSchoolsJson: { markers?: MapPointMarker[] } | null = null;

      if (sidoRes.status === 'fulfilled' && sidoRes.value.ok) {
        sidoJson = (await sidoRes.value.json()) as { statsByCode?: RegionVoteMap };
      }
      if (sigunguRes.status === 'fulfilled' && sigunguRes.value.ok) {
        sigunguJson = (await sigunguRes.value.json()) as { statsByCode?: RegionVoteMap };
      }
      if (topSchoolsRes.status === 'fulfilled' && topSchoolsRes.value.ok) {
        topSchoolsJson = (await topSchoolsRes.value.json()) as { markers?: MapPointMarker[] };
      }

      const nextMapStats: RegionVoteMap = {
        ...(sidoJson?.statsByCode ?? {}),
        ...(sigunguJson?.statsByCode ?? {}),
      };

      setMapStats(nextMapStats);
      if (topSchoolsJson && Array.isArray(topSchoolsJson.markers)) {
        setTopSchoolMarkers(topSchoolsJson.markers);
      } else {
        setTopSchoolMarkers([]);
      }
      writeCachedRegionState({
        cacheKey: HOME_MAP_CACHE_KEY,
        statsByCode: nextMapStats,
      });
    } catch {
      // keep current map state on transient fetch failures
    }
  }, []);

  const loadFeaturedSummary = useCallback(
    async (topicId: string) => {
      setIsStatsLoading(true);
      try {
        const response = await fetch(
          `/api/votes/region-stats?scope=topic&topicId=${encodeURIComponent(topicId)}&level=sido&ts=${Date.now()}`,
          { cache: 'no-store' },
        );

        if (!response.ok) {
          setSummary(emptySummary);
          return;
        }

        const json = (await response.json()) as {
          summary?: { totalVotes: number; countA: number; countB: number };
        };

        if (json.summary) {
          setSummary(normalizeSummary(json.summary));
        } else {
          setSummary(emptySummary);
        }
      } catch {
        setSummary(emptySummary);
      } finally {
        setIsStatsLoading(false);
      }
    },
    [emptySummary],
  );

  useEffect(() => {
    const cachedRegionState = readCachedRegionState(HOME_MAP_CACHE_KEY);
    if (cachedRegionState) {
      setMapStats(cachedRegionState.statsByCode);
      return;
    }

    setMapStats({});
  }, []);

  useEffect(() => {
    void loadHomeMapStats();
  }, [loadHomeMapStats]);

  useEffect(() => {
    const refresh = () => {
      void loadHomeMapStats();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pageshow', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pageshow', refresh);
    };
  }, [loadHomeMapStats]);

  useEffect(() => {
    const topicId = featuredTopic?.id;
    if (!topicId) {
      setSummary(emptySummary);
      setIsStatsLoading(false);
      return;
    }

    void loadFeaturedSummary(topicId);
  }, [emptySummary, featuredTopic?.id, loadFeaturedSummary]);

  useEffect(() => {
    const topicId = featuredTopic?.id;
    if (!topicId) {
      return;
    }

    const refresh = () => {
      void loadFeaturedSummary(topicId);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pageshow', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pageshow', refresh);
    };
  }, [featuredTopic?.id, loadFeaturedSummary]);

  useEffect(() => {
    const storedProfile = readPendingProfile();
    if (storedProfile) {
      setBirthYear(storedProfile.birthYear);
      setGender(normalizeBinaryGender(storedProfile.gender));
      setSelectedSchool(storedProfile.school);
      setSchoolQuery(storedProfile.school.schoolName);
    } else if (profile?.birth_year) {
      setBirthYear(profile.birth_year);
      setGender(normalizeBinaryGender(profile.gender));
    }
  }, [profile?.birth_year, profile?.gender]);

  useEffect(() => {
    const topicId = featuredTopic?.id;
    if (!topicId) {
      setGuestHasVoted(false);
      return;
    }

    setGuestHasVoted(readPendingVotes().includes(topicId));
  }, [featuredTopic?.id]);

  useEffect(() => {
    let cancelled = false;

    const syncFeaturedVoteState = async () => {
      const topicId = featuredTopic?.id;
      if (!topicId) {
        setFeaturedHasVoted(false);
        return;
      }

      if (!isAuthenticated && !guestSessionId) {
        setFeaturedHasVoted(guestHasVoted);
        return;
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

        const query = new URLSearchParams({ topicId });
        if (!isAuthenticated && guestSessionId) {
          query.set('guestSessionId', guestSessionId);
        }

        const response = await fetch(`/api/votes/result-summary?${query.toString()}`, {
          cache: 'no-store',
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        });

        if (!response.ok) {
          if (!cancelled) {
            setFeaturedHasVoted(!isAuthenticated && guestHasVoted);
          }
          return;
        }

        const json = (await response.json()) as FeaturedResultSummaryResponse;
        if (cancelled) {
          return;
        }

        const hasVote = Boolean(json.viewer?.hasVote);
        setFeaturedHasVoted(hasVote || (!isAuthenticated && guestHasVoted));

        const votedOptionKey = json.myChoice?.optionKey ?? null;
        if (hasVote && votedOptionKey) {
          setSelectedOption(votedOptionKey);
        }
      } catch {
        if (!cancelled) {
          setFeaturedHasVoted(!isAuthenticated && guestHasVoted);
        }
      }
    };

    void syncFeaturedVoteState();

    return () => {
      cancelled = true;
    };
  }, [featuredTopic?.id, guestHasVoted, guestSessionId, isAuthenticated]);

  const canOpenFeaturedResult = useMemo(() => {
    if (!featuredTopic?.id) {
      return false;
    }
    return isAuthenticated ? featuredHasVoted : guestHasVoted;
  }, [featuredHasVoted, featuredTopic?.id, guestHasVoted, isAuthenticated]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!selectedRegion) {
        setRegionHotTopics([]);
        setRegionHotTopicsError(null);
        setIsRegionHotTopicsLoading(false);
        return;
      }

      setIsRegionHotTopicsLoading(true);
      setRegionHotTopicsError(null);
      try {
        const query = new URLSearchParams({
          level: selectedRegion.level,
          code: selectedRegion.code,
          limit: '3',
        });

        const response = await fetch(`/api/votes/top-topics-by-region?${query.toString()}`, {
          cache: 'no-store',
        });
        const json = (await response.json()) as RegionHotTopicsResponse;

        if (!response.ok) {
          if (!cancelled) {
            setRegionHotTopics([]);
            setRegionHotTopicsError(json.error ?? '지역 인기 주제를 불러오지 못했습니다.');
          }
          return;
        }

        if (!cancelled) {
          setRegionHotTopics(Array.isArray(json.topics) ? json.topics : []);
        }
      } catch {
        if (!cancelled) {
          setRegionHotTopics([]);
          setRegionHotTopicsError('지역 인기 주제를 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) {
          setIsRegionHotTopicsLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [selectedRegion]);

  useEffect(() => {
    if (!selectedRegion) {
      return;
    }

    const handlePointerDownOutside = (event: PointerEvent) => {
      const panel = selectedRegionPanelRef.current;
      const target = event.target as Node | null;
      if (!panel || (target && panel.contains(target))) {
        return;
      }

      setSelectedRegion(null);
    };

    document.addEventListener('pointerdown', handlePointerDownOutside);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside);
    };
  }, [selectedRegion]);

  useEffect(() => {
    const adNode = bottomDockRef.current;
    const menuNode = bottomMenuRef.current;
    if (!adNode && !menuNode) {
      return;
    }

    const updateHeights = () => {
      const nextAd = adNode ? Math.ceil(adNode.getBoundingClientRect().height) : 0;
      const nextMenu = menuNode ? Math.ceil(menuNode.getBoundingClientRect().height) : 0;
      setBottomAdHeight(nextAd > 0 ? nextAd : 0);
      setBottomMenuHeight(nextMenu > 0 ? nextMenu : 0);
    };

    updateHeights();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => updateHeights());
    if (adNode) {
      observer.observe(adNode);
    }
    if (menuNode) {
      observer.observe(menuNode);
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const hintNode = topicHintRef.current;
    if (!hintNode) {
      setTopicHintHeight(0);
      return;
    }

    const updateHintHeight = () => {
      const nextHeight = Math.ceil(hintNode.getBoundingClientRect().height);
      setTopicHintHeight(nextHeight > 0 ? nextHeight : 0);
    };

    updateHintHeight();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => updateHintHeight());
    observer.observe(hintNode);
    return () => observer.disconnect();
  }, [isTopicPickerOpen]);

  useEffect(() => {
    const gridNode = bottomMenuGridRef.current;
    const mapButtonNode = mapTabButtonRef.current;
    if (!gridNode || !mapButtonNode) {
      return;
    }

    const updateAnchor = () => {
      const gridRect = gridNode.getBoundingClientRect();
      const mapRect = mapButtonNode.getBoundingClientRect();
      if (gridRect.width <= 0) {
        return;
      }
      const centerX = mapRect.left + mapRect.width / 2;
      const ratio = ((centerX - gridRect.left) / gridRect.width) * 100;
      const clamped = Math.max(8, Math.min(92, ratio));
      setTopicHintAnchorPercent(clamped);
    };

    updateAnchor();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateAnchor);
      return () => window.removeEventListener('resize', updateAnchor);
    }

    const observer = new ResizeObserver(() => updateAnchor());
    observer.observe(gridNode);
    observer.observe(mapButtonNode);
    window.addEventListener('resize', updateAnchor);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateAnchor);
    };
  }, [bottomAdHeight, bottomMenuHeight, isTopicPickerOpen]);

  useEffect(() => {
    if (!showProfileModal) {
      return;
    }

    if (!schoolQuery.trim()) {
      setSchoolResults([]);
      return;
    }

    const handle = setTimeout(async () => {
      setIsSchoolSearching(true);
      try {
        const res = await fetch(
          `/api/schools/search?q=${encodeURIComponent(schoolQuery.trim())}&level=all&limit=12`,
          { cache: 'no-store' },
        );
        const json = (await res.json()) as { items?: SchoolSearchItem[] };
        setSchoolResults(json.items ?? []);
      } catch {
        setSchoolResults([]);
      } finally {
        setIsSchoolSearching(false);
      }
    }, 260);

    return () => clearTimeout(handle);
  }, [schoolQuery, showProfileModal]);

  useEffect(() => {
    if (!isSchoolListVisible || isSchoolSearching || schoolResults.length === 0) {
      setHighlightedSchoolIndex(0);
      return;
    }

    setHighlightedSchoolIndex((prev) => Math.min(Math.max(prev, 0), schoolResults.length - 1));
  }, [isSchoolListVisible, isSchoolSearching, schoolResults.length]);

  useEffect(() => {
    if (!isSchoolListVisible || schoolResults.length === 0) {
      return;
    }

    const listNode = schoolResultsListRef.current;
    if (!listNode) {
      return;
    }

    const targetButton = listNode.querySelector<HTMLButtonElement>(`[data-school-index="${highlightedSchoolIndex}"]`);
    targetButton?.scrollIntoView({ block: 'nearest' });
  }, [highlightedSchoolIndex, isSchoolListVisible, schoolResults.length]);

  const handleSelectSchool = useCallback((school: SchoolSearchItem) => {
    setSelectedSchool(school);
    setSchoolQuery(school.schoolName);
    setHighlightedSchoolIndex(0);
  }, []);

  const savePendingProfile = useCallback((): VoteProfileInput | null => {
    if (!selectedSchool) {
      return null;
    }

    const payload: VoteProfileInput = {
      birthYear,
      gender,
      school: selectedSchool,
    };
    writePendingProfile(payload);
    return payload;
  }, [birthYear, gender, selectedSchool]);

  const submitVote = useCallback(
    async (profilePayload: VoteProfileInput | null) => {
      setIsSubmittingVote(true);
      setVoteMessage(null);
      const topicId = featuredTopic?.id ?? null;
      const optionKey = selectedOption;
      const optionAKey = featuredOptionAKey;
      const optionBKey = featuredOptionBKey;

      if (!topicId || !optionAKey || !optionBKey) {
        setVoteMessage('현재 투표 가능한 주제가 없습니다.');
        setIsSubmittingVote(false);
        return;
      }

      if (!optionKey) {
        setVoteMessage('먼저 선택지를 선택해 주세요.');
        setIsSubmittingVote(false);
        return;
      }

      try {
        if (!isAuthenticated && !guestSessionId) {
          setVoteMessage('세션 연결 중입니다. 잠시 후 다시 시도해 주세요.');
          return;
        }

        let accessToken: string | null = null;
        if (isAuthenticated) {
          const supabase = getSupabaseBrowserClient();
          if (supabase) {
            const { data } = await supabase.auth.getSession();
            accessToken = data.session?.access_token ?? null;
          }
        }

        const response = await fetch('/api/votes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            topicId,
            optionKey,
            guestSessionId: isAuthenticated ? undefined : guestSessionId,
            ...(profilePayload ? { profile: profilePayload } : {}),
          }),
        });

        const json = (await response.json()) as { error?: string };
        if (!response.ok) {
          if (response.status === 409) {
            setVoteMessage('이미 해당 주제에 투표했습니다.');
            if (!isAuthenticated) {
              setGuestHasVoted(true);
            }
            return;
          }
          setVoteMessage(json.error ?? '투표 처리 중 오류가 발생했습니다.');
          return;
        }

        if (!isAuthenticated) {
          addPendingVoteTopic(topicId);
          setGuestHasVoted(true);
        }

        const optimisticSidoCode = profilePayload?.school.sidoCode ?? profile?.sido_code ?? null;
        const optimisticSigunguCode = profilePayload?.school.sigunguCode ?? profile?.sigungu_code ?? null;

        if (optimisticSidoCode || optimisticSigunguCode) {
          let optimisticMap = mapStats;
          if (optimisticSidoCode) {
            optimisticMap = bumpRegionStat(optimisticMap, optimisticSidoCode, optionKey, optionAKey, optionBKey);
          }
          if (optimisticSigunguCode) {
            optimisticMap = bumpRegionStat(optimisticMap, optimisticSigunguCode, optionKey, optionAKey, optionBKey);
          }

          writeCachedRegionState({
            cacheKey: HOME_MAP_CACHE_KEY,
            statsByCode: optimisticMap,
          });

          setMapStats((prev) => {
            let next = prev;
            if (optimisticSidoCode) {
              next = bumpRegionStat(next, optimisticSidoCode, optionKey, optionAKey, optionBKey);
            }
            if (optimisticSigunguCode) {
              next = bumpRegionStat(next, optimisticSigunguCode, optionKey, optionAKey, optionBKey);
            }
            return next;
          });

          setSummary((prev) =>
            normalizeSummary({
              totalVotes: prev.totalVotes + 1,
              countA: prev.countA + (optionKey === optionAKey ? 1 : 0),
              countB: prev.countB + (optionKey === optionBKey ? 1 : 0),
            }),
          );
        }

        setVoteMessage('투표가 반영되었습니다.');
        router.push(`/results/${topicId}`);
        return;
      } catch {
        setVoteMessage('투표 처리 중 오류가 발생했습니다.');
      } finally {
        setIsSubmittingVote(false);
      }
    },
    [
      featuredOptionAKey,
      featuredOptionBKey,
      featuredTopic?.id,
      guestSessionId,
      isAuthenticated,
      mapStats,
      profile?.sido_code,
      profile?.sigungu_code,
      router,
      selectedOption,
    ],
  );

  const handleVote = useCallback(async () => {
    if (canOpenFeaturedResult && featuredTopic?.id) {
      router.push(`/results/${featuredTopic.id}`);
      return;
    }

    if (!featuredTopic || !featuredOptionAKey || !featuredOptionBKey) {
      setVoteMessage('현재 투표 가능한 주제가 없습니다.');
      setIsVoteCardCollapsed(false);
      return;
    }

    if (!selectedOption) {
      setVoteMessage('먼저 선택지를 선택해 주세요.');
      setIsVoteCardCollapsed(false);
      return;
    }

    const payload = savePendingProfile();
    if (payload) {
      await submitVote(payload);
      return;
    }

    if (isAuthenticated && hasServerProfile) {
      await submitVote(null);
      return;
    }

    setVoteAfterProfile(true);
    setShowProfileModal(true);
  }, [
    canOpenFeaturedResult,
    featuredOptionAKey,
    featuredOptionBKey,
    featuredTopic,
    hasServerProfile,
    isAuthenticated,
    router,
    savePendingProfile,
    selectedOption,
    submitVote,
  ]);

  const submitTopicPickerVote = useCallback(
    async (targetVote: PendingTopicPickerVote, profilePayload: VoteProfileInput | null) => {
      const { topicId, optionKey, optionAKey, optionBKey } = targetVote;
      setIsPickerSubmittingVote(true);
      setPickerVoteMessage(null);
      try {
        if (!isAuthenticated && !guestSessionId) {
          setPickerVoteMessage('세션 연결 중입니다. 잠시 후 다시 시도해 주세요.');
          return;
        }

        let accessToken: string | null = null;
        if (isAuthenticated) {
          const supabase = getSupabaseBrowserClient();
          if (supabase) {
            const { data } = await supabase.auth.getSession();
            accessToken = data.session?.access_token ?? null;
          }
        }

        const response = await fetch('/api/votes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            topicId,
            optionKey,
            guestSessionId: isAuthenticated ? undefined : guestSessionId,
            ...(profilePayload ? { profile: profilePayload } : {}),
          }),
        });

        const json = (await response.json()) as { error?: string };
        if (!response.ok) {
          if (response.status === 409) {
            setPickerVoteMessage('이미 투표한 주제입니다. 결과 페이지로 이동합니다.');
            if (!isAuthenticated) {
              setGuestHasVoted(true);
            }
            setIsTopicPickerOpen(false);
            router.push(`/results/${topicId}`);
            return;
          }
          setPickerVoteMessage(json.error ?? '투표 처리 중 오류가 발생했습니다.');
          return;
        }

        if (!isAuthenticated) {
          addPendingVoteTopic(topicId);
          setGuestHasVoted(true);
        }

        const optimisticSidoCode = profilePayload?.school.sidoCode ?? profile?.sido_code ?? null;
        const optimisticSigunguCode = profilePayload?.school.sigunguCode ?? profile?.sigungu_code ?? null;

        if (optimisticSidoCode || optimisticSigunguCode) {
          let optimisticMap = mapStats;
          if (optimisticSidoCode) {
            optimisticMap = bumpRegionStat(optimisticMap, optimisticSidoCode, optionKey, optionAKey, optionBKey);
          }
          if (optimisticSigunguCode) {
            optimisticMap = bumpRegionStat(optimisticMap, optimisticSigunguCode, optionKey, optionAKey, optionBKey);
          }

          writeCachedRegionState({
            cacheKey: HOME_MAP_CACHE_KEY,
            statsByCode: optimisticMap,
          });

          setMapStats((prev) => {
            let next = prev;
            if (optimisticSidoCode) {
              next = bumpRegionStat(next, optimisticSidoCode, optionKey, optionAKey, optionBKey);
            }
            if (optimisticSigunguCode) {
              next = bumpRegionStat(next, optimisticSigunguCode, optionKey, optionAKey, optionBKey);
            }
            return next;
          });

          if (featuredTopic?.id === topicId) {
            setSummary((prev) =>
              normalizeSummary({
                totalVotes: prev.totalVotes + 1,
                countA: prev.countA + (optionKey === optionAKey ? 1 : 0),
                countB: prev.countB + (optionKey === optionBKey ? 1 : 0),
              }),
            );
          }
        }

        setPickerVoteMessage('투표가 반영되었습니다. 결과 페이지로 이동합니다.');
        setIsTopicPickerOpen(false);
        router.push(`/results/${topicId}`);
      } catch {
        setPickerVoteMessage('투표 처리 중 오류가 발생했습니다.');
      } finally {
        setIsPickerSubmittingVote(false);
      }
    },
    [
      featuredTopic?.id,
      guestSessionId,
      isAuthenticated,
      mapStats,
      profile?.sido_code,
      profile?.sigungu_code,
      router,
    ],
  );

  const handleTopicPickerVoteSubmit = useCallback(
    async (topic: VoteTopic) => {
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

      const targetVote: PendingTopicPickerVote = {
        topicId: topic.id,
        optionKey: pickerSelectedOptionKey,
        optionAKey: optionA.key,
        optionBKey: optionB.key,
      };

      const payload = savePendingProfile();
      if (payload) {
        await submitTopicPickerVote(targetVote, payload);
        return;
      }

      if (isAuthenticated && hasServerProfile) {
        await submitTopicPickerVote(targetVote, null);
        return;
      }

      setPendingPickerVote(targetVote);
      setVoteAfterProfile(false);
      setShowProfileModal(true);
    },
    [hasServerProfile, isAuthenticated, pickerSelectedOptionKey, savePendingProfile, submitTopicPickerVote],
  );

  const handleSaveProfileOnly = useCallback(async () => {
    const payload = savePendingProfile();
    if (!payload) {
      if (pendingPickerVote) {
        setPickerVoteMessage('학교를 선택해 주세요.');
      } else {
        setVoteMessage('학교를 선택해 주세요.');
      }
      return;
    }

    setShowProfileModal(false);

    if (pendingPickerVote) {
      const pendingVote = pendingPickerVote;
      setPendingPickerVote(null);
      await submitTopicPickerVote(pendingVote, payload);
      return;
    }

    if (voteAfterProfile) {
      setVoteAfterProfile(false);
      await submitVote(payload);
    } else {
      setVoteMessage('프로필이 저장되었습니다.');
    }
  }, [pendingPickerVote, savePendingProfile, submitTopicPickerVote, submitVote, voteAfterProfile]);

  const handleTopicPickerClose = useCallback(() => {
    setIsTopicPickerOpen(false);
    setExpandedPickerTopicId(null);
    setPickerSelectedOptionKey(null);
    setPickerVoteMessage(null);
    setPendingPickerVote(null);
    setActiveTab('home');
  }, []);

  const handleTopicPickerToggle = useCallback((topicId: string) => {
    setPickerVoteMessage(null);
    setTopicsError(null);
    setExpandedPickerTopicId((prev) => {
      if (prev === topicId) {
        setPickerSelectedOptionKey(null);
        return null;
      }
      setPickerSelectedOptionKey(null);
      return topicId;
    });
  }, []);

  const handleBottomTabClick = useCallback(
    (tab: 'home' | 'map' | 'rank' | 'me') => {
      if (tab === 'map') {
        setActiveTab('map');
        setIsTopicPickerOpen(true);
        setExpandedPickerTopicId(null);
        setPickerSelectedOptionKey(null);
        setPickerVoteMessage(null);
        return;
      }
      setIsTopicPickerOpen(false);
      setActiveTab(tab);
    },
    [],
  );

  const handleBottomDockWheel = useCallback((event: WheelEvent<HTMLElement>) => {
    if (event.deltaY === 0) {
      return;
    }
    event.preventDefault();
    window.scrollBy({ top: event.deltaY, behavior: 'auto' });
  }, []);

  const resetBottomDockTouchState = useCallback(() => {
    dockTouchStartYRef.current = null;
    dockTouchLastYRef.current = null;
    dockTouchMovedRef.current = false;
  }, []);

  const handleBottomDockTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    const y = event.touches[0]?.clientY;
    if (typeof y !== 'number') {
      return;
    }
    dockTouchStartYRef.current = y;
    dockTouchLastYRef.current = y;
    dockTouchMovedRef.current = false;
  }, []);

  const handleBottomDockTouchMove = useCallback((event: TouchEvent<HTMLElement>) => {
    const y = event.touches[0]?.clientY;
    const startY = dockTouchStartYRef.current;
    const lastY = dockTouchLastYRef.current;
    if (typeof y !== 'number' || startY === null || lastY === null) {
      return;
    }

    const totalDelta = Math.abs(y - startY);
    if (!dockTouchMovedRef.current && totalDelta < DOCK_SCROLL_TOUCH_THRESHOLD_PX) {
      return;
    }

    if (!dockTouchMovedRef.current) {
      dockTouchMovedRef.current = true;
    }

    const stepDelta = lastY - y;
    if (stepDelta !== 0) {
      event.preventDefault();
      window.scrollBy({ top: stepDelta, behavior: 'auto' });
    }
    dockTouchLastYRef.current = y;
  }, []);

  const handleBottomDockTouchEnd = useCallback(() => {
    resetBottomDockTouchState();
  }, [resetBottomDockTouchState]);

  useEffect(() => {
    if (!isTopicPickerOpen) {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleTopicPickerClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [handleTopicPickerClose, isTopicPickerOpen]);

  return (
    <div className="bg-black text-white">
      <main className="relative h-screen w-full overflow-hidden [font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text','SF_Pro_Display','Segoe_UI',sans-serif]">
      <div className="absolute inset-0">
        <KoreaAdminMap
          statsByCode={mergedMapStats}
          pointMarkers={topSchoolMarkers}
          markerEffect="gps"
          fillMode="activity"
          height="100%"
          initialCenter={MAIN_INITIAL_CENTER}
          initialZoom={MAIN_INITIAL_ZOOM}
          bottomDockHeightPx={bottomDockHeight}
          toggleClearancePx={18}
          theme="dark"
          showTooltip={false}
          showNavigationControl={false}
          showRegionLevelToggle
          regionLevelToggleAlign="right"
          colors={MAIN_MAP_COLORS}
          onMapZoomDirectionChange={({ direction }) => {
            if (direction === 'in') {
              setIsVoteCardCollapsed(true);
            }
          }}
          onRegionClick={(region) =>
            setSelectedRegion((prev) =>
              prev && prev.code === region.code && prev.level === region.level ? null : region,
            )
          }
          className="h-full w-full !rounded-none !border-0"
        />
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,_rgba(4,10,18,0.55),_rgba(4,10,18,0.18)_38%,_rgba(4,10,18,0.74))]" />
      <div className="pointer-events-none absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 mix-blend-soft-light" />

      <div
        className="pointer-events-none relative z-20 mx-auto flex h-full w-full max-w-[430px] flex-col px-4 pt-[calc(0.5rem+env(safe-area-inset-top))]"
        style={{ paddingBottom: `calc(9.2rem + env(safe-area-inset-bottom) + ${hintReservePaddingPx}px)` }}
      >
        <LiveVoteCard
          className="shrink-0"
          topicId={featuredTopic?.id ?? null}
          title={featuredTopic?.title ?? '진행중인 주제를 준비 중입니다.'}
          isExpanded={!isVoteCardCollapsed}
          onToggleExpanded={() => setIsVoteCardCollapsed((prev) => !prev)}
          selectedOptionKey={selectedOption}
          onSelectOption={setSelectedOption}
          onSubmitVote={() => void handleVote()}
          submitDisabled={
            canOpenFeaturedResult
              ? false
              : !selectedOption ||
                !featuredTopic ||
                !featuredOptionAKey ||
                !featuredOptionBKey ||
                isFeaturedLoading ||
                isSubmittingVote ||
                (!isAuthenticated && !guestSessionId)
          }
          submitLabel={
            isSubmittingVote
              ? '처리 중...'
              : canOpenFeaturedResult
                ? '이미 투표완료하셨습니다 · 결과보기'
              : !selectedOption
                ? '선택 후 투표하기'
                : '투표 제출하기'
          }
          message={voteMessage}
          isStatsLoading={isStatsLoading}
          totalVotes={summary.totalVotes}
          realtimeVotes={featuredMetrics?.realtimeVotes ?? null}
          leftOption={{
            key: featuredOptionAKey,
            label: featuredOptionALabel,
            percentage: summary.hasData ? summary.aPercent : null,
            subtext: getOptionSubtext(featuredTopic?.id, featuredOptionAKey),
          }}
          rightOption={{
            key: featuredOptionBKey,
            label: featuredOptionBLabel,
            percentage: summary.hasData ? summary.bPercent : null,
            subtext: getOptionSubtext(featuredTopic?.id, featuredOptionBKey),
          }}
          auth={{
            isLoading,
            isAuthenticated,
            avatarUrl: profile?.avatar_url ?? null,
            displayInitial: (profile?.full_name ?? profile?.email ?? user?.email ?? 'U').slice(0, 1),
            onSignOut: signOut,
          }}
        />

        {selectedRegion ? (
          <section
            ref={selectedRegionPanelRef}
            className="pointer-events-auto mt-3 shrink-0 rounded-[20px] border border-white/14 bg-[rgba(12,18,28,0.72)] p-3.5 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-2xl"
          >
            <div className="flex items-center justify-between">
              <h4 className="truncate text-[15px] font-semibold text-white">
                {selectedRegion.name || selectedRegion.code}
              </h4>
              <span className="rounded-full border border-white/18 bg-white/8 px-2.5 py-1 text-[11px] font-semibold text-white/75">
                {selectedRegion.level === 'sido' ? '시/도' : '시/군/구'}
              </span>
            </div>

            <p className="mt-2 text-[12px] text-white/68">
              누적 투표수{' '}
              <span className="font-semibold text-white">
                {((selectedRegionStat?.total ?? 0) || 0).toLocaleString()}표
              </span>
            </p>

            <div className="mt-2.5 rounded-xl border border-white/14 bg-white/[0.03] px-3 py-2.5">
              <p className="text-[12px] font-semibold text-white/84">이 지역에서 가장 활발한 주제 TOP 3</p>

              {isRegionHotTopicsLoading ? (
                <div className="mt-2.5 space-y-2">
                  <div className="h-9 animate-pulse rounded-lg bg-white/8" />
                  <div className="h-9 animate-pulse rounded-lg bg-white/8" />
                  <div className="h-9 animate-pulse rounded-lg bg-white/8" />
                </div>
              ) : regionHotTopics.length > 0 ? (
                <div className="mt-2 space-y-1.5">
                  {regionHotTopics.map((topic, index) => (
                    <button
                      key={topic.topicId}
                      type="button"
                      onClick={() => router.push(`/results/${topic.topicId}`)}
                      className="inline-flex h-11 w-full cursor-pointer items-center justify-between rounded-lg border border-white/12 bg-white/[0.04] px-2.5 text-left transition hover:bg-white/[0.08]"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-[11px] font-bold text-white/86">
                          {index + 1}
                        </span>
                        <span className="truncate text-[12px] font-medium text-white/88">{topic.title}</span>
                      </div>
                      <span className="ml-2 shrink-0 text-[11px] font-semibold text-[#8fb8ff]">
                        {topic.voteCount.toLocaleString()}표
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[12px] text-white/62">
                  {regionHotTopicsError ?? '이 지역의 인기 주제 데이터가 아직 충분하지 않습니다.'}
                </p>
              )}
            </div>
          </section>
        ) : null}

        <div className="h-3" />
      </div>

      <div
        ref={bottomDockRef}
        className="pointer-events-none absolute inset-x-0 bottom-0 z-30 transition-opacity duration-200 md:hidden"
      >
        <section
          onWheel={handleBottomDockWheel}
          onTouchStart={handleBottomDockTouchStart}
          onTouchMove={handleBottomDockTouchMove}
          onTouchEnd={handleBottomDockTouchEnd}
          onTouchCancel={handleBottomDockTouchEnd}
          className="pointer-events-auto border-t border-white/14 bg-[rgba(12,18,28,0.82)] pb-[calc(0.55rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.32)] backdrop-blur-2xl"
          style={{ touchAction: 'pan-y' }}
        >
          <div className="mx-auto max-w-[430px] px-3">
            <section className="rounded-xl border border-white/14 bg-[rgba(255,255,255,0.06)] px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-6 shrink-0 items-center rounded-md border border-[#ff9f0a66] bg-[#ff9f0a22] px-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#ffcc8a]">
                  광고
                </span>
                <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-white/80">
                  스폰서 배너 영역입니다.
                </p>
                <button
                  type="button"
                  className="inline-flex h-11 shrink-0 items-center rounded-lg border border-white/18 bg-white/8 px-3 text-[11px] font-semibold text-white/84 transition hover:bg-white/12"
                >
                  자세히
                </button>
              </div>
            </section>
          </div>
        </section>
      </div>

      <div
        ref={bottomMenuRef}
        className="pointer-events-none absolute inset-x-0 z-20 transition-opacity duration-200 md:hidden"
        style={{ bottom: `${bottomAdHeight}px` }}
      >
        <nav className="pointer-events-auto rounded-t-[24px] border-t border-white/14 bg-[rgba(12,18,28,0.82)] pb-2 pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
          <div ref={bottomMenuGridRef} className="mx-auto grid max-w-[430px] grid-cols-4 gap-2 px-3">
            {[
              { id: 'home' as const, label: '홈' },
              { id: 'map' as const, label: '지도' },
              { id: 'rank' as const, label: '랭킹' },
              { id: 'me' as const, label: 'MY' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                ref={tab.id === 'map' ? mapTabButtonRef : undefined}
                onClick={() => handleBottomTabClick(tab.id)}
                className={`inline-flex h-11 items-center justify-center rounded-2xl text-[14px] font-semibold transition ${
                  activeTab === tab.id ? 'bg-white/14 text-[#ff9f0a]' : 'text-white/62 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </nav>
      </div>

      <div
        className={`pointer-events-none absolute inset-x-0 z-30 transition-opacity duration-200 md:hidden ${
          isTopicPickerOpen ? 'opacity-0' : 'opacity-100'
        }`}
        style={{ bottom: `${bottomAdHeight + (bottomMenuHeight > 0 ? bottomMenuHeight : 62) - 2}px` }}
      >
        <div ref={topicHintRef} className="mx-auto max-w-[430px] px-3">
          <div className="relative h-[48px]">
            <div
              className="absolute top-0 -translate-x-1/2"
              style={{ left: `${topicHintAnchorPercent}%` }}
            >
              <div className="flex flex-col items-center leading-none">
                <span className="whitespace-nowrap text-[11px] font-semibold tracking-[-0.01em] text-[#ffd2a6]">
                  여기서 다른 주제를 선택하세요
                </span>
                <svg
                  className="home-chevron mt-0.5"
                  width="30"
                  height="36"
                  viewBox="0 0 100 130"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <defs>
                    <polyline
                      id="home-chevron-shape"
                      points="38,8 50,24 62,8"
                      stroke="#ff9f0a"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </defs>
                  <g className="home-chevron-group">
                    <use href="#home-chevron-shape" />
                    <use href="#home-chevron-shape" />
                    <use href="#home-chevron-shape" />
                  </g>
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isTopicPickerOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/58 p-4 md:hidden"
          onClick={handleTopicPickerClose}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-topic-picker-title"
            className="w-full max-w-[430px] overflow-hidden rounded-[28px] border border-white/12 bg-[rgba(22,22,26,0.96)] shadow-2xl backdrop-blur-2xl"
            style={{ maxHeight: 'calc(100dvh - 2rem)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 pb-3 pt-4">
              <div>
                <h4 id="home-topic-picker-title" className="text-[20px] font-semibold text-white">
                  다른 주제 선택
                </h4>
                <p className="mt-1 text-xs text-white/60">선택하면 바로 투표 카드가 펼쳐집니다.</p>
              </div>
              <button
                type="button"
                aria-label="주제 선택 팝업 닫기"
                onClick={handleTopicPickerClose}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/14 bg-white/6 text-lg text-white/80 transition hover:bg-white/12 hover:text-white"
              >
                ×
              </button>
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

                  <div
                    className="max-h-[52dvh] overflow-y-auto pr-1"
                    style={{
                      paddingBottom: topicListBottomInset,
                      scrollPaddingBottom: topicListBottomInset,
                    }}
                  >
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
                          const isSelectionReady = Boolean(
                            pickerSelectedOptionKey && optionA && optionB && !isPickerSubmittingVote,
                          );

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
                                  isExpanded ? 'max-h-[320px] opacity-100 translate-y-0' : 'pointer-events-none max-h-0 -translate-y-1 opacity-0'
                                }`}
                              >
                                <div className="border-t border-white/10 px-3 pb-3 pt-2.5">
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
                                      {pickerVoteMessage ? (
                                        <p className="mt-2 text-xs text-[#ffd0a6]">{pickerVoteMessage}</p>
                                      ) : null}
                                      <button
                                        type="button"
                                        onClick={() => void handleTopicPickerVoteSubmit(topic)}
                                        disabled={!isSelectionReady}
                                        className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-xl border border-[#ff9f0a66] bg-[#ff6b00] text-[13px] font-bold text-white transition hover:bg-[#ff7b1d] disabled:cursor-not-allowed disabled:border-white/20 disabled:bg-white/10 disabled:text-white/45"
                                      >
                                        {isPickerSubmittingVote ? '처리 중...' : '투표 후 결과 보기'}
                                      </button>
                                    </>
                                  ) : (
                                    <p className="mt-2 text-xs text-[#ffb4b4]">
                                      이 주제는 선택지 정보를 불러오지 못했습니다.
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {showProfileModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-4 sm:items-center">
          <div className="w-full max-w-[430px] rounded-[28px] border border-white/12 bg-[rgba(22,22,26,0.95)] p-5 shadow-2xl backdrop-blur-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-[20px] font-semibold text-white">최초 투표 정보 입력</h4>
              <button
                type="button"
                onClick={() => {
                  setShowProfileModal(false);
                  setVoteAfterProfile(false);
                  setPendingPickerVote(null);
                }}
                className="rounded-lg px-2 py-1 text-sm text-white/65 hover:bg-white/10 hover:text-white"
              >
                닫기
              </button>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-white/70">출생연도</span>
                <select
                  value={String(birthYear)}
                  onChange={(event) => {
                    const nextYear = Number(event.target.value);
                    if (Number.isFinite(nextYear)) {
                      setBirthYear(nextYear);
                    }
                  }}
                  className="h-10 w-full rounded-xl border border-white/14 bg-white/8 px-3 text-sm text-white outline-none transition focus:border-[#ff9f0a66]"
                >
                  {birthYearOptions.map((option) => (
                    <option key={option.value} value={option.value} className="bg-[#1f1f24] text-white">
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-white/70">성별</span>
                <select
                  value={gender}
                  onChange={(event) => {
                    const nextGender = event.target.value;
                    if (nextGender === 'male' || nextGender === 'female') {
                      setGender(nextGender);
                    }
                  }}
                  className="h-10 w-full rounded-xl border border-white/14 bg-white/8 px-3 text-sm text-white outline-none transition focus:border-[#ff9f0a66]"
                >
                  {GENDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} className="bg-[#1f1f24] text-white">
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-white/70">학교 검색</span>
                <input
                  value={schoolQuery}
                  onKeyDown={(event) => {
                    if (!isSchoolListVisible || isSchoolSearching || schoolResults.length === 0) {
                      return;
                    }

                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setHighlightedSchoolIndex((prev) => Math.min(prev + 1, schoolResults.length - 1));
                      return;
                    }

                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      setHighlightedSchoolIndex((prev) => Math.max(prev - 1, 0));
                      return;
                    }

                    if (event.key === 'Enter') {
                      event.preventDefault();
                      const target = schoolResults[Math.min(highlightedSchoolIndex, schoolResults.length - 1)];
                      if (target) {
                        handleSelectSchool(target);
                      }
                    }
                  }}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setSchoolQuery(nextValue);
                    setHighlightedSchoolIndex(0);
                    if (selectedSchool && nextValue !== selectedSchool.schoolName) {
                      setSelectedSchool(null);
                    }
                  }}
                  placeholder="학교명을 입력하세요"
                  autoComplete="off"
                  className="h-10 w-full rounded-xl border border-white/14 bg-white/8 px-3 text-sm text-white outline-none placeholder:text-white/45 transition focus:border-[#ff9f0a66]"
                />
                {isSchoolListVisible ? (
                  <div
                    ref={schoolResultsListRef}
                    className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-white/14 bg-[rgba(26,26,30,0.96)] p-1.5"
                  >
                    {isSchoolSearching ? (
                      <p className="px-2 py-2 text-xs text-white/70">학교 검색 중...</p>
                    ) : schoolResults.length === 0 ? (
                      <p className="px-2 py-2 text-xs text-white/60">검색 결과가 없습니다.</p>
                    ) : (
                      schoolResults.map((school, index) => (
                        <button
                          key={`${school.source}:${school.schoolCode}`}
                          data-school-index={index}
                          type="button"
                          onMouseEnter={() => setHighlightedSchoolIndex(index)}
                          onClick={() => handleSelectSchool(school)}
                          className={`mb-1 block w-full rounded-lg px-2 py-2 text-left text-sm text-white/85 transition last:mb-0 ${
                            index === highlightedSchoolIndex ? 'bg-white/12' : 'hover:bg-white/10'
                          }`}
                        >
                          <p className="font-semibold">{school.schoolName}</p>
                          <p className="mt-0.5 text-[11px] text-white/60">
                            {school.sidoName ?? '-'} · {school.schoolLevel}
                            {school.campusType ? ` · ${school.campusType}` : ''}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
                {selectedSchool ? (
                  <p className="mt-1 text-[11px] font-medium text-[#ffcc99]">
                    선택됨: {selectedSchool.schoolName}
                  </p>
                ) : null}
              </label>

              <button
                type="button"
                onClick={() => void handleSaveProfileOnly()}
                disabled={!selectedSchool}
                className="inline-flex h-12 w-full items-center justify-center rounded-2xl border border-[#ff9f0a66] bg-[#ff6b00] text-[15px] font-bold text-white shadow-[0_8px_24px_rgba(255,107,0,0.35)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                저장{voteAfterProfile || pendingPickerVote ? ' 후 투표하기' : ''}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      </main>

      <style jsx>{`
        .home-chevron-group > use {
          animation: home-chevron-appear 2s ease-in-out infinite;
          opacity: 0;
          transform-box: fill-box;
          transform-origin: center;
        }
        .home-chevron-group > use:nth-child(1) {
          --base: 0px;
          animation-delay: 0s;
          stroke: #ff9f0a;
        }
        .home-chevron-group > use:nth-child(2) {
          --base: 20px;
          animation-delay: 0.25s;
          stroke: rgba(255, 167, 64, 0.95);
        }
        .home-chevron-group > use:nth-child(3) {
          --base: 40px;
          animation-delay: 0.5s;
          stroke: rgba(255, 189, 120, 0.88);
        }
        @keyframes home-chevron-appear {
          0% {
            opacity: 0;
            transform: translateY(calc(var(--base) - 12px));
          }
          20% {
            opacity: 1;
            transform: translateY(var(--base));
          }
          55% {
            opacity: 1;
            transform: translateY(var(--base));
          }
          75% {
            opacity: 0;
            transform: translateY(calc(var(--base) + 8px));
          }
          100% {
            opacity: 0;
            transform: translateY(calc(var(--base) - 12px));
          }
        }
      `}</style>

      <footer className="relative border-t border-white/10 bg-[rgba(10,14,22,0.96)]">
        <div
          className="mx-auto w-full max-w-[430px] px-4 pb-4 pt-6 text-white/72"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
        >
          <p className="text-sm font-semibold text-white/88">Vote War Map</p>
          <p className="mt-2 text-xs text-white/60">© 2026 Vote War Map. All rights reserved.</p>
          <p className="mt-2 text-xs text-white/55">문의/정책 안내 페이지는 추후 업데이트될 예정입니다.</p>
        </div>
      </footer>
    </div>
  );
}
