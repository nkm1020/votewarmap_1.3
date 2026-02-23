'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ActivityIcon, ChevronDownIcon, ChevronUpIcon, CircleCheckIcon, MapPinIcon } from 'lucide-react';
import type { MapPointMarker, RegionVoteMap } from '@/components/KoreaAdminMap';
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
import type { Gender, SchoolSearchItem, VoteProfileInput, VoteTopic } from '@/lib/vote/types';
import { TagSelector } from '@/components/ui/tag-selector';

const KoreaAdminMap = dynamic(() => import('@/components/KoreaAdminMap'), { ssr: false });

const MAIN_INITIAL_CENTER: [number, number] = [127.75, 36.18];
const MAIN_INITIAL_ZOOM = 6.0;
const MAIN_MAP_COLORS = {
  a: 'rgba(255, 90, 0, 0.95)',
  b: 'rgba(30, 120, 255, 0.95)',
  tie: 'rgba(255, 193, 63, 0.95)',
  neutral: 'rgba(42, 34, 30, 0.18)',
} as const;
const TOPIC_SELECTION_LIMIT = 10;
const TOPIC_SHEET_PEEK_HEIGHT = 38;
const TOPIC_SHEET_SWIPE_THRESHOLD_PX = 42;
const GENDER_OPTIONS: Array<{ value: Gender; label: string }> = [
  { value: 'male', label: '남성' },
  { value: 'female', label: '여성' },
];

type TopicSheetDetent = 'closed' | 'full';
type TopicCategory = 'food' | 'relationship' | 'work' | 'imagination';
type TopicTab = 'all' | TopicCategory;
type FeaturedTopicMetrics = {
  totalVotes: number;
  realtimeVotes: number;
  score: number;
  lastVoteAt: string | null;
};

type CachedRegionStatePayload = {
  topicId: string;
  statsByCode: RegionVoteMap;
  summary: { totalVotes: number; countA: number; countB: number };
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

function readCachedRegionState(topicId: string | null): CachedRegionStatePayload | null {
  if (!topicId) {
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
    if (!parsed.statsByCode || !parsed.summary || parsed.topicId !== topicId) {
      return null;
    }

    return {
      topicId: parsed.topicId,
      statsByCode: parsed.statsByCode,
      summary: parsed.summary,
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
  const prefersReducedMotion = useReducedMotion();
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
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [voteMessage, setVoteMessage] = useState<string | null>(null);
  const [isSubmittingVote, setIsSubmittingVote] = useState(false);
  const [isVoteCardCollapsed, setIsVoteCardCollapsed] = useState(true);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [isSchoolSearching, setIsSchoolSearching] = useState(false);
  const [schoolResults, setSchoolResults] = useState<SchoolSearchItem[]>([]);
  const [schoolQuery, setSchoolQuery] = useState('');
  const [birthYear, setBirthYear] = useState<number>(() => new Date().getFullYear() - 17);
  const [gender, setGender] = useState<Gender>('male');
  const [selectedSchool, setSelectedSchool] = useState<SchoolSearchItem | null>(null);
  const [voteAfterProfile, setVoteAfterProfile] = useState(false);
  const [guestHasVoted, setGuestHasVoted] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<{
    code: string;
    name: string;
    level: 'sido' | 'sigungu';
  } | null>(null);
  const [topicSheetDetent, setTopicSheetDetent] = useState<TopicSheetDetent>('closed');
  const [activeTopicTab, setActiveTopicTab] = useState<TopicTab>('all');
  const [availableTopics, setAvailableTopics] = useState<VoteTopic[]>([]);
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [isTopicsLoading, setIsTopicsLoading] = useState(false);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [bottomDockHeight, setBottomDockHeight] = useState(124);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const bottomDockRef = useRef<HTMLDivElement | null>(null);
  const topicSheetTouchStartYRef = useRef<number | null>(null);
  const topicSheetTouchCurrentYRef = useRef<number | null>(null);

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
  const cardEase: [number, number, number, number] = [0.2, 0.65, 0.3, 0.9];
  const cardTransition = {
    duration: prefersReducedMotion ? 0.12 : 0.32,
    ease: cardEase,
  };
  const cardLayoutTransition = {
    layout: {
      duration: prefersReducedMotion ? 0.12 : 0.35,
      ease: cardEase,
    },
  };
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
  const selectedBirthYearTag = useMemo(
    () => [{ value: String(birthYear), label: `${birthYear}년` }],
    [birthYear],
  );
  const selectedGenderTag = useMemo(() => {
    const match = GENDER_OPTIONS.find((option) => option.value === gender);
    return match ? [match] : [];
  }, [gender]);
  const selectedSchoolTag = useMemo(() => (selectedSchool ? [selectedSchool] : []), [selectedSchool]);
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
    if (activeTopicTab === 'all') {
      return sortedTopics;
    }
    return topicsByCategory[activeTopicTab];
  }, [activeTopicTab, sortedTopics, topicsByCategory]);
  const selectedTopicTags = useMemo(() => {
    if (selectedTopicIds.length === 0) {
      return [];
    }

    const byId = new Map(sortedTopics.map((topic) => [topic.id, topic]));
    return selectedTopicIds
      .map((id) => byId.get(id))
      .filter((topic): topic is VoteTopic => Boolean(topic));
  }, [selectedTopicIds, sortedTopics]);
  const isTopicSheetOpen = topicSheetDetent !== 'closed';
  const topicSheetTransform = useMemo(() => {
    if (topicSheetDetent === 'full') {
      return 'translateY(0)';
    }
    return `translateY(calc(100% - (${bottomDockHeight}px + ${TOPIC_SHEET_PEEK_HEIGHT}px)))`;
  }, [bottomDockHeight, topicSheetDetent]);

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
            setSelectedTopicIds([]);
          }
          return;
        }

        const nextTopics = json.topics ?? [];
        if (cancelled) {
          return;
        }

        setAvailableTopics(nextTopics);
        setSelectedTopicIds((prev) => {
          const validIds = prev.filter((id) => nextTopics.some((topic) => topic.id === id));
          if (validIds.length > 0) {
            return validIds.slice(0, TOPIC_SELECTION_LIMIT);
          }

          const defaults: string[] = [];
          nextTopics.forEach((topic) => {
            if (defaults.length >= Math.min(3, TOPIC_SELECTION_LIMIT)) {
              return;
            }
            if (!defaults.includes(topic.id)) {
              defaults.push(topic.id);
            }
          });

          return defaults;
        });
      } catch {
        if (!cancelled) {
          setTopicsError('주제 목록을 불러오지 못했습니다.');
          setAvailableTopics([]);
          setSelectedTopicIds([]);
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

  const loadRegionStats = useCallback(async (topicId: string) => {
    setIsStatsLoading(true);
    try {
      const nonce = Date.now();
      const [sidoRes, sigunguRes, topSchoolsRes] = await Promise.allSettled([
        fetch(`/api/votes/region-stats?topicId=${encodeURIComponent(topicId)}&level=sido&ts=${nonce}`, {
          cache: 'no-store',
        }),
        fetch(`/api/votes/region-stats?topicId=${encodeURIComponent(topicId)}&level=sigungu&ts=${nonce}`, {
          cache: 'no-store',
        }),
        fetch(
          `/api/votes/top-schools-by-region?scope=topic&topicId=${encodeURIComponent(topicId)}&ts=${nonce}`,
          { cache: 'no-store' },
        ),
      ]);

      let sidoJson:
        | {
            statsByCode?: RegionVoteMap;
            summary?: { totalVotes: number; countA: number; countB: number };
          }
        | null = null;
      let sigunguJson: { statsByCode?: RegionVoteMap } | null = null;
      let topSchoolsJson: { markers?: MapPointMarker[] } | null = null;

      if (sidoRes.status === 'fulfilled' && sidoRes.value.ok) {
        sidoJson = (await sidoRes.value.json()) as {
          statsByCode?: RegionVoteMap;
          summary?: { totalVotes: number; countA: number; countB: number };
        };
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
      }

      if (sidoJson?.summary) {
        setSummary(normalizeSummary(sidoJson.summary));
        writeCachedRegionState({
          topicId,
          statsByCode: nextMapStats,
          summary: sidoJson.summary,
        });
      } else {
        setSummary(
          normalizeSummary({
            totalVotes: 0,
            countA: 0,
            countB: 0,
          }),
        );
      }
    } catch {
      // keep current map state on transient fetch failures
    } finally {
      setIsStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    const topicId = featuredTopic?.id;
    if (!topicId) {
      return;
    }

    const handleFocus = () => {
      void loadRegionStats(topicId);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadRegionStats(topicId);
      }
    };
    const handlePageShow = () => {
      void loadRegionStats(topicId);
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [featuredTopic?.id, loadRegionStats]);

  useEffect(() => {
    const topicId = featuredTopic?.id ?? null;
    const emptySummary = normalizeSummary({
      totalVotes: 0,
      countA: 0,
      countB: 0,
    });

    if (!topicId) {
      setMapStats({});
      setTopSchoolMarkers([]);
      setSummary(emptySummary);
      setIsStatsLoading(false);
      return;
    }

    const cachedRegionState = readCachedRegionState(topicId);
    if (cachedRegionState) {
      setMapStats(cachedRegionState.statsByCode);
      setSummary(normalizeSummary(cachedRegionState.summary));
      setIsStatsLoading(false);
      return;
    }

    setMapStats({});
    setTopSchoolMarkers([]);
    setSummary(emptySummary);
  }, [featuredTopic?.id]);

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
    const topicId = featuredTopic?.id;
    if (!topicId) {
      return;
    }

    void loadRegionStats(topicId);
  }, [featuredTopic?.id, loadRegionStats]);

  useEffect(() => {
    if (!isProfileMenuOpen) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isProfileMenuOpen]);

  useEffect(() => {
    if (!isAuthenticated) {
      setIsProfileMenuOpen(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const node = bottomDockRef.current;
    if (!node || typeof ResizeObserver === 'undefined') {
      return;
    }

    const updateHeight = () => {
      const next = Math.max(124, Math.ceil(node.getBoundingClientRect().height));
      if (next > 0) {
        setBottomDockHeight(next);
      }
    };

    updateHeight();
    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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

          const optimisticSummary = {
            totalVotes: summary.totalVotes + 1,
            countA: summary.countA + (optionKey === optionAKey ? 1 : 0),
            countB: summary.countB + (optionKey === optionBKey ? 1 : 0),
          };

          writeCachedRegionState({
            topicId,
            statsByCode: optimisticMap,
            summary: optimisticSummary,
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
        await loadRegionStats(topicId);
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
      loadRegionStats,
      mapStats,
      profile?.sido_code,
      profile?.sigungu_code,
      selectedOption,
      summary.countA,
      summary.countB,
      summary.totalVotes,
    ],
  );

  const handleVote = useCallback(async () => {
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
    featuredOptionAKey,
    featuredOptionBKey,
    featuredTopic,
    hasServerProfile,
    isAuthenticated,
    savePendingProfile,
    selectedOption,
    submitVote,
  ]);

  const handleSaveProfileOnly = useCallback(async () => {
    const payload = savePendingProfile();
    if (!payload) {
      setVoteMessage('학교를 선택해 주세요.');
      return;
    }

    setShowProfileModal(false);
    if (voteAfterProfile) {
      setVoteAfterProfile(false);
      await submitVote(payload);
    } else {
      setVoteMessage('프로필이 저장되었습니다.');
    }
  }, [savePendingProfile, submitVote, voteAfterProfile]);

  const handleTopicToggle = useCallback(
    (topic: VoteTopic) => {
      const alreadySelected = selectedTopicIds.includes(topic.id);
      if (alreadySelected) {
        setSelectedTopicIds((prev) => prev.filter((id) => id !== topic.id));
        setTopicsError(null);
        return;
      }

      if (selectedTopicIds.length >= TOPIC_SELECTION_LIMIT) {
        setTopicsError(`주제는 최대 ${TOPIC_SELECTION_LIMIT}개까지 선택할 수 있습니다.`);
        return;
      }

      setSelectedTopicIds((prev) => (prev.includes(topic.id) ? prev : [...prev, topic.id]));
      setTopicsError(null);
    },
    [selectedTopicIds],
  );

  const handleRemoveSelectedTopic = useCallback((topicId: string) => {
    setSelectedTopicIds((prev) => prev.filter((id) => id !== topicId));
    setTopicsError(null);
  }, []);

  const handleTopicSelectionComplete = useCallback(() => {
    if (selectedTopicIds.length === 0) {
      setTopicsError('주제를 1개 이상 선택해 주세요.');
      return;
    }

    setTopicsError(null);
    const params = new URLSearchParams({ topics: selectedTopicIds.join(',') });
    setTopicSheetDetent('closed');
    router.push(`/topics-map?${params.toString()}`);
  }, [router, selectedTopicIds]);

  const handleTopicSheetTouchStart = useCallback((event: TouchEvent<HTMLButtonElement>) => {
    const y = event.touches[0]?.clientY;
    if (typeof y !== 'number') {
      return;
    }

    topicSheetTouchStartYRef.current = y;
    topicSheetTouchCurrentYRef.current = y;
  }, []);

  const handleTopicSheetTouchMove = useCallback((event: TouchEvent<HTMLButtonElement>) => {
    const y = event.touches[0]?.clientY;
    if (typeof y !== 'number') {
      return;
    }
    topicSheetTouchCurrentYRef.current = y;
  }, []);

  const handleTopicSheetTouchEnd = useCallback(() => {
    const startY = topicSheetTouchStartYRef.current;
    const currentY = topicSheetTouchCurrentYRef.current;
    topicSheetTouchStartYRef.current = null;
    topicSheetTouchCurrentYRef.current = null;

    if (startY === null || currentY === null) {
      return;
    }

    const deltaY = currentY - startY;
    if (deltaY <= -TOPIC_SHEET_SWIPE_THRESHOLD_PX) {
      setTopicSheetDetent('full');
      return;
    }

    if (deltaY >= TOPIC_SHEET_SWIPE_THRESHOLD_PX) {
      setTopicSheetDetent('closed');
    }
  }, []);

  const handleTopicSheetHandleClick = useCallback(() => {
    setTopicSheetDetent((prev) => (prev === 'closed' ? 'full' : 'closed'));
  }, []);

  return (
    <main className="relative h-screen w-full overflow-hidden bg-black text-white [font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text','SF_Pro_Display','Segoe_UI',sans-serif]">
      <div className="absolute inset-0">
        <KoreaAdminMap
          statsByCode={mergedMapStats}
          pointMarkers={topSchoolMarkers}
          markerEffect="gps"
          height="100%"
          initialCenter={MAIN_INITIAL_CENTER}
          initialZoom={MAIN_INITIAL_ZOOM}
          bottomDockHeightPx={bottomDockHeight}
          toggleClearancePx={18}
          theme="dark"
          showTooltip={false}
          showNavigationControl={false}
          showRegionLevelToggle
          colors={MAIN_MAP_COLORS}
          onMapZoomDirectionChange={({ direction }) => {
            if (direction === 'in') {
              setIsVoteCardCollapsed(true);
            }
          }}
          onMapPointerDown={() => {
            setTopicSheetDetent('closed');
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

      <div className="pointer-events-none relative z-20 mx-auto flex h-full w-full max-w-[430px] flex-col px-4 pb-[calc(9.2rem+env(safe-area-inset-bottom))] pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <motion.section
          layout
          transition={cardLayoutTransition}
          className="pointer-events-auto relative w-full shrink-0 overflow-hidden rounded-[30px] border border-white/14 bg-gradient-to-br from-[rgba(10,18,30,0.9)] via-[rgba(8,14,24,0.95)] to-[rgba(6,10,18,0.96)] shadow-[0_26px_52px_rgba(0,0,0,0.45)] backdrop-blur-2xl backdrop-saturate-150"
        >
          <header className="flex items-center gap-3 border-b border-white/5 bg-white/5 px-5 py-4">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 shadow-inner">
              <MapPinIcon className="h-5 w-5 text-[#ff9f0a]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white/90">대한민국 실시간 논쟁 투표</p>
              <p className="truncate text-xs font-medium text-white/50">세기의 난제 의견 수렴</p>
            </div>
            {isLoading ? (
              <span className="inline-flex h-9 items-center rounded-full border border-white/10 bg-white/5 px-3 text-xs font-semibold text-white/80">
                ...
              </span>
            ) : isAuthenticated ? (
              <div ref={profileMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setIsProfileMenuOpen((prev) => !prev)}
                  aria-label="내 계정 메뉴"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/92 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f0a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1522]"
                >
                  {profile?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profile.avatar_url}
                      alt="프로필"
                      className="h-7 w-7 rounded-full border border-white/20 object-cover"
                    />
                  ) : (
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-white/10 text-[11px] font-bold">
                      {(profile?.full_name ?? user?.email ?? 'U').slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </button>

                {isProfileMenuOpen ? (
                  <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-36 rounded-xl border border-white/15 bg-[rgba(20,20,24,0.94)] p-1.5 shadow-[0_10px_26px_rgba(0,0,0,0.38)] backdrop-blur-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setIsProfileMenuOpen(false);
                        void signOut();
                      }}
                      className="inline-flex h-9 w-full items-center justify-center rounded-lg text-[13px] font-semibold text-white/85 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7fb0ff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#141418]"
                    >
                      로그아웃
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <Link
                href="/auth"
                className="inline-flex h-9 items-center rounded-full border border-white/10 bg-white/5 px-4 text-xs font-semibold text-white/90 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f0a]"
              >
                로그인
              </Link>
            )}
          </header>

          <div className="p-5">
            <motion.div layout className="mb-6 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#ff9f0a4d] bg-[#ff9f0a1a] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#ffad33]">
                    <ActivityIcon className="h-3 w-3" />
                    LIVE
                  </span>
                  <span className="text-[11px] font-medium text-white/50">진행중인 투표</span>
                </div>
                <h2 className="text-xl font-bold leading-tight text-white/95">
                  {featuredTopic?.title ?? '진행중인 주제를 준비 중입니다.'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsVoteCardCollapsed((prev) => !prev)}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-semibold text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f0a]"
              >
                {isVoteCardCollapsed ? (
                  <>
                    참여하기
                    <ChevronDownIcon className="h-3.5 w-3.5" />
                  </>
                ) : (
                  <>
                    접기
                    <ChevronUpIcon className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            </motion.div>

            <motion.div layout className="mb-2">
              <div className="mb-2 flex items-center justify-between text-sm font-semibold">
                <span className="flex items-center gap-1.5 text-[#ff8b2f]">
                  {featuredOptionALabel}
                  <span className="text-white/90">{summary.hasData ? `${summary.aPercent}%` : '-'}</span>
                </span>
                <span className="flex items-center gap-1.5 text-[#6ea6ff]">
                  <span className="text-white/90">{summary.hasData ? `${summary.bPercent}%` : '-'}</span>
                  {featuredOptionBLabel}
                </span>
              </div>
              <div className="relative h-3 overflow-hidden rounded-full bg-slate-800 shadow-inner">
                {summary.hasData ? (
                  <>
                    <motion.div
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#ff6b00] to-[#ff9f0a]"
                      initial={{ width: 0 }}
                      animate={{ width: `${summary.aPercent}%` }}
                      transition={{ duration: 0.55, ease: 'easeOut' }}
                    />
                    <motion.div
                      className="absolute inset-y-0 right-0 bg-gradient-to-l from-[#2f74ff] to-[#6ea6ff]"
                      initial={{ width: 0 }}
                      animate={{ width: `${summary.bPercent}%` }}
                      transition={{ duration: 0.55, ease: 'easeOut' }}
                    />
                  </>
                ) : (
                  <div className="absolute inset-0 bg-white/8" />
                )}
              </div>
              <div className="mt-2 text-center">
                <span className="text-[11px] font-medium text-white/40">
                  {isStatsLoading
                    ? '집계 중...'
                    : `총 ${summary.totalVotes.toLocaleString()}명 참여${
                        featuredMetrics ? ` · 실시간 ${featuredMetrics.realtimeVotes.toLocaleString()}표` : ''
                      }`}
                </span>
              </div>
            </motion.div>

            <AnimatePresence initial={false}>
              {!isVoteCardCollapsed ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={cardTransition}
                  className="overflow-hidden"
                >
                  <div className="mt-6 border-t border-white/10 pt-6">
                    <div className="mb-5 grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (featuredOptionAKey) {
                            setSelectedOption(featuredOptionAKey);
                          }
                        }}
                        aria-pressed={selectedOption === featuredOptionAKey}
                        disabled={!featuredOptionAKey}
                        className={`relative flex min-h-[108px] flex-col items-center justify-center rounded-2xl border p-4 text-center transition-all duration-200 ${
                          selectedOption === featuredOptionAKey
                            ? 'border-[#ff6b00] bg-[#ff6b001a] shadow-[0_0_20px_rgba(255,107,0,0.18)]'
                            : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        {selectedOption === featuredOptionAKey ? (
                          <span className="absolute right-2 top-2">
                            <CircleCheckIcon className="h-4 w-4 text-[#ff9f0a]" />
                          </span>
                        ) : null}
                        <span
                          className={`text-lg font-bold ${
                            selectedOption === featuredOptionAKey ? 'text-[#ffad33]' : 'text-white/85'
                          }`}
                        >
                          {featuredOptionALabel}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (featuredOptionBKey) {
                            setSelectedOption(featuredOptionBKey);
                          }
                        }}
                        aria-pressed={selectedOption === featuredOptionBKey}
                        disabled={!featuredOptionBKey}
                        className={`relative flex min-h-[108px] flex-col items-center justify-center rounded-2xl border p-4 text-center transition-all duration-200 ${
                          selectedOption === featuredOptionBKey
                            ? 'border-[#2f74ff] bg-[#2f74ff1a] shadow-[0_0_20px_rgba(47,116,255,0.18)]'
                            : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        {selectedOption === featuredOptionBKey ? (
                          <span className="absolute right-2 top-2">
                            <CircleCheckIcon className="h-4 w-4 text-[#6ea6ff]" />
                          </span>
                        ) : null}
                        <span
                          className={`text-lg font-bold ${
                            selectedOption === featuredOptionBKey ? 'text-[#6ea6ff]' : 'text-white/85'
                          }`}
                        >
                          {featuredOptionBLabel}
                        </span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleVote()}
                      disabled={
                        !selectedOption ||
                        !featuredTopic ||
                        !featuredOptionAKey ||
                        !featuredOptionBKey ||
                        isFeaturedLoading ||
                        isSubmittingVote ||
                        (!isAuthenticated && guestHasVoted) ||
                        (!isAuthenticated && !guestSessionId)
                      }
                      className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(140deg,#ff6b00_0%,#ff8a1f_100%)] text-base font-bold text-white shadow-[0_0_20px_rgba(255,107,0,0.35)] transition-all duration-200 hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f0a] disabled:cursor-not-allowed disabled:opacity-65"
                    >
                      {isSubmittingVote
                        ? '처리 중...'
                        : !selectedOption
                          ? '선택 후 투표하기'
                          : !isAuthenticated && guestHasVoted
                            ? '이미 투표 완료'
                            : '투표 제출하기'}
                    </button>

                    {voteMessage ? <p className="mt-3 text-center text-xs text-white/85">{voteMessage}</p> : null}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </motion.section>

        {selectedRegion ? (
          <section className="pointer-events-auto mt-3 shrink-0 rounded-[20px] border border-white/14 bg-[rgba(12,18,28,0.72)] p-3.5 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
            <div className="flex items-center justify-between">
              <h4 className="truncate text-[15px] font-semibold text-white">
                {selectedRegion.name || selectedRegion.code}
              </h4>
              <span className="rounded-full border border-white/18 bg-white/8 px-2.5 py-1 text-[11px] font-semibold text-white/75">
                {selectedRegion.level === 'sido' ? '시/도' : '시/군/구'}
              </span>
            </div>

            {selectedRegionStat ? (
              (() => {
                const countA = selectedRegionStat.countA ?? 0;
                const countB = selectedRegionStat.countB ?? 0;
                const total = selectedRegionStat.total ?? countA + countB;
                const aPercent = total > 0 ? Math.round((countA / total) * 100) : 0;
                const bPercent = total > 0 ? Math.max(0, 100 - aPercent) : 0;
                return (
                  <div className="mt-2.5">
                    <div className="flex items-center justify-between text-[12px] text-white/80">
                      <span>{featuredOptionALabel} {aPercent}%</span>
                      <span>{featuredOptionBLabel} {bPercent}%</span>
                    </div>
                    <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full bg-[#ff6b00]" style={{ width: `${aPercent}%` }} />
                      <div className="h-full bg-[#2f74ff]" style={{ width: `${bPercent}%` }} />
                    </div>
                    <p className="mt-2 text-[12px] text-white/65">
                      참여 {total.toLocaleString()}표 · {featuredOptionALabel} {countA.toLocaleString()} · {featuredOptionBLabel}{' '}
                      {countB.toLocaleString()}
                    </p>
                  </div>
                );
              })()
            ) : (
              <p className="mt-2 text-[12px] text-white/60">이 지역에는 아직 투표 데이터가 없습니다.</p>
            )}
          </section>
        ) : null}

        <div className="h-3" />
      </div>

      <div ref={bottomDockRef} className="pointer-events-none fixed inset-x-0 bottom-0 z-30">
        <nav className="pointer-events-auto rounded-t-[24px] border-t border-white/14 bg-[rgba(12,18,28,0.82)] pb-[calc(0.55rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
          <div className="mx-auto grid max-w-[430px] grid-cols-4 gap-2 px-3">
            {[
              { id: 'home' as const, label: '홈' },
              { id: 'map' as const, label: '지도' },
              { id: 'rank' as const, label: '랭킹' },
              { id: 'me' as const, label: 'MY' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex h-11 items-center justify-center rounded-2xl text-[14px] font-semibold transition ${
                  activeTab === tab.id ? 'bg-white/14 text-[#ff9f0a]' : 'text-white/62 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="mx-auto mt-2 max-w-[430px] px-3">
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
        </nav>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-4">
        <section
          className="pointer-events-auto w-full max-w-[430px] overflow-hidden rounded-t-[28px] border border-white/12 bg-[rgba(22,22,26,0.97)] shadow-2xl backdrop-blur-2xl transition-transform duration-300 ease-[cubic-bezier(0.2,0.65,0.3,0.9)]"
          style={{
            transform: topicSheetTransform,
            maxHeight: 'calc(100dvh - 12px - env(safe-area-inset-top))',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-expanded={isTopicSheetOpen}
            onClick={handleTopicSheetHandleClick}
            onTouchStart={handleTopicSheetTouchStart}
            onTouchMove={handleTopicSheetTouchMove}
            onTouchEnd={handleTopicSheetTouchEnd}
            onTouchCancel={handleTopicSheetTouchEnd}
            className="flex w-full flex-col items-center gap-1.5 border-b border-white/10 px-4 pb-2 pt-2.5"
          >
            <span className="h-1.5 w-12 rounded-full bg-white/35" />
            <span className="text-[11px] font-semibold text-white/68">
              {topicSheetDetent === 'full'
                ? '아래로 쓸어 내려 축소'
                : '위로 쓸어 올려 다른 주제 선택'}
            </span>
          </button>

          <div
            className={`px-5 pb-5 pt-3 transition-opacity duration-200 ${
              topicSheetDetent === 'closed'
                ? 'pointer-events-none opacity-0'
                : 'pointer-events-auto opacity-100'
            }`}
            style={{
              height: 'calc(100dvh - 84px - env(safe-area-inset-top))',
              maxHeight: 'calc(100dvh - 84px - env(safe-area-inset-top))',
            }}
          >
            <div className="flex h-full min-h-0 flex-col">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-[20px] font-semibold text-white">다른 주제 선택</h4>
                  <p className="mt-1 text-xs text-white/60">
                    1개 이상 선택 · 최대 {TOPIC_SELECTION_LIMIT}개
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleTopicSelectionComplete}
                  disabled={selectedTopicIds.length === 0}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-[#ff9f0a66] bg-[#ff6b00] px-3 text-sm font-semibold text-white transition hover:bg-[#ff7c1f] disabled:cursor-not-allowed disabled:border-white/20 disabled:bg-white/10 disabled:text-white/45"
                >
                  선택 완료
                </button>
              </div>

              {isTopicsLoading ? (
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white/70">
                  주제 불러오는 중...
                </div>
              ) : availableTopics.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white/70">
                  선택 가능한 LIVE 주제가 없습니다.
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

                  <section className="mb-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12px] font-semibold text-white/84">담은 주제</p>
                      <span className="text-[11px] text-white/56">
                        {selectedTopicIds.length}/{TOPIC_SELECTION_LIMIT}
                      </span>
                    </div>
                    {selectedTopicTags.length === 0 ? (
                      <p className="mt-2 text-xs text-white/56">주제를 담아보세요.</p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedTopicTags.map((topic) => (
                          <span
                            key={topic.id}
                            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#ff9f0a55] bg-[#ff9f0a26] px-2.5 py-1 text-[12px] text-white"
                          >
                            <span className="truncate">{topic.title}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveSelectedTopic(topic.id)}
                              className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/25 text-[11px] text-white/86 hover:bg-black/40 hover:text-white"
                              aria-label={`${topic.title} 제거`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </section>

                  <p className="min-h-5 text-xs text-white/65">{topicsError ?? `선택됨 ${selectedTopicIds.length}개`}</p>

                  <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
                    {filteredTopics.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-white/20 bg-white/5 px-3 py-3 text-sm text-white/65">
                        이 카테고리에 표시할 주제가 없습니다.
                      </div>
                    ) : (
                      <div className="space-y-2 pb-1">
                        {filteredTopics.map((topic) => {
                          const isSelected = selectedTopicIds.includes(topic.id);
                          return (
                            <button
                              key={topic.id}
                              type="button"
                              onClick={() => handleTopicToggle(topic)}
                              className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition ${
                                isSelected
                                  ? 'border-[#ff9f0a66] bg-[#ff9f0a22] text-white'
                                  : 'border-white/14 bg-white/5 text-white/84 hover:border-white/28 hover:bg-white/10'
                              }`}
                            >
                              <p className="line-clamp-2 text-[14px] font-medium leading-5">{topic.title}</p>
                              <span
                                className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[13px] font-bold ${
                                  isSelected
                                    ? 'border-[#ffb75d] bg-[#ff9f0a33] text-[#ffd8a4]'
                                    : 'border-white/24 bg-white/6 text-white/55'
                                }`}
                              >
                                {isSelected ? '✓' : '+'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </div>

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
                }}
                className="rounded-lg px-2 py-1 text-sm text-white/65 hover:bg-white/10 hover:text-white"
              >
                닫기
              </button>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-white/70">출생연도</span>
                <TagSelector<{ value: string; label: string }>
                  availableTags={birthYearOptions}
                  selectedTags={selectedBirthYearTag}
                  onChange={(tags) => {
                    const nextYear = Number(tags[0]?.value);
                    if (Number.isFinite(nextYear)) {
                      setBirthYear(nextYear);
                    }
                  }}
                  getValue={(tag) => tag.value}
                  getLabel={(tag) => tag.label}
                  heading="출생연도"
                  placeholder="출생연도 선택"
                  inputPlaceholder="출생연도 검색"
                  emptyMessage="조건에 맞는 연도가 없습니다."
                  allowClear={false}
                  multiple={false}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-white/70">성별</span>
                <TagSelector<{ value: Gender; label: string }>
                  availableTags={GENDER_OPTIONS}
                  selectedTags={selectedGenderTag}
                  onChange={(tags) => {
                    const nextGender = tags[0]?.value;
                    if (nextGender === 'male' || nextGender === 'female') {
                      setGender(nextGender);
                    }
                  }}
                  getValue={(tag) => tag.value}
                  getLabel={(tag) => tag.label}
                  heading="성별"
                  placeholder="성별 선택"
                  inputPlaceholder="성별 검색"
                  emptyMessage="조건에 맞는 성별이 없습니다."
                  allowClear={false}
                  multiple={false}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-white/70">학교 검색</span>
                <TagSelector<SchoolSearchItem>
                  availableTags={schoolResults}
                  selectedTags={selectedSchoolTag}
                  onChange={(tags) => {
                    const nextSchool = tags[0] ?? null;
                    setSelectedSchool(nextSchool);
                    setSchoolQuery(nextSchool?.schoolName ?? '');
                  }}
                  getValue={(school) => `${school.source}:${school.schoolCode}`}
                  getLabel={(school) => school.schoolName}
                  heading="학교"
                  placeholder="학교를 선택하세요"
                  inputPlaceholder="학교명을 입력하세요"
                  emptyMessage={schoolQuery.trim() ? '검색 결과가 없습니다.' : '학교명을 입력해 주세요.'}
                  loadingMessage="학교 검색 중..."
                  isLoading={isSchoolSearching}
                  multiple={false}
                  inputValue={schoolQuery}
                  onInputValueChange={(value) => {
                    setSchoolQuery(value);
                    if (selectedSchool && value !== selectedSchool.schoolName) {
                      setSelectedSchool(null);
                    }
                  }}
                  renderOption={(school) => (
                    <>
                      <p className="font-semibold">{school.schoolName}</p>
                      <p className="mt-0.5 text-[11px] text-white/60">
                        {school.sidoName ?? '-'} · {school.schoolLevel}
                        {school.campusType ? ` · ${school.campusType}` : ''}
                      </p>
                    </>
                  )}
                />
              </label>

              <button
                type="button"
                onClick={() => void handleSaveProfileOnly()}
                disabled={!selectedSchool}
                className="inline-flex h-12 w-full items-center justify-center rounded-2xl border border-[#ff9f0a66] bg-[#ff6b00] text-[15px] font-bold text-white shadow-[0_8px_24px_rgba(255,107,0,0.35)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                저장{voteAfterProfile ? ' 후 투표하기' : ''}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
