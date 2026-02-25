'use client';

import dynamic from 'next/dynamic';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LiveVoteCard } from '@/components/vote/LiveVoteCard';
import { useAuth } from '@/contexts/AuthContext';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  addPendingVoteTopic,
  readPendingRegionInput,
  readPendingVotes,
  writePendingRegionInput,
} from '@/lib/vote/client-storage';
import { useGuestSessionHeartbeat } from '@/lib/vote/guest-session';
import { resolveVoteRegionInputFromCurrentLocation } from '@/lib/vote/location-region';
import { getOptionSubtext } from '@/lib/vote/option-subtext-map';
import type { SchoolSearchItem, VoteRegionInput, VoteTopic } from '@/lib/vote/types';
import type { RegionVoteMap } from './KoreaAdminMap';

const KoreaAdminMap = dynamic(() => import('@/components/KoreaAdminMap'), { ssr: false });
const TOPICS_MAP_INITIAL_CENTER: [number, number] = [127.75, 36.18];
const TOPICS_MAP_COLORS = {
  a: 'rgba(255, 90, 0, 0.95)',
  b: 'rgba(30, 120, 255, 0.95)',
  tie: 'rgba(255, 193, 63, 0.95)',
  neutral: 'rgba(42, 34, 30, 0.18)',
} as const;
const REGION_MODAL_HINT =
  '지역과 결과 비교를 위해 학교를 입력하시거나 정확한 위치 사용을 허용해주세요.';
const SIGNUP_COMPLETION_REQUIRED_MESSAGE = '투표 전에 회원가입 정보를 먼저 입력해 주세요.';
const TOPIC_SELECTOR_STACK_GAP_PX = 12;

type TopicsMapPageProps = {
  initialTopicIds: string[];
  openTopicEditorOnMount?: boolean;
};

type VoteSummary = {
  totalVotes: number;
  countA: number;
  countB: number;
  aPercent: number;
  bPercent: number;
  hasData: boolean;
};
type VoteRegionInputByGps = Extract<VoteRegionInput, { source: 'gps' }>;
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

export default function TopicsMapPage({ initialTopicIds, openTopicEditorOnMount = false }: TopicsMapPageProps) {
  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();
  const [availableTopics, setAvailableTopics] = useState<VoteTopic[]>([]);
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>(() => initialTopicIds);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [selectedOptionKey, setSelectedOptionKey] = useState<string>('');
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [isTopicsLoading, setIsTopicsLoading] = useState(true);
  const [mapStats, setMapStats] = useState<RegionVoteMap>({});
  const [isStatsLoading, setIsStatsLoading] = useState(false);
  const [summary, setSummary] = useState<VoteSummary>({
    totalVotes: 0,
    countA: 0,
    countB: 0,
    aPercent: 0,
    bPercent: 0,
    hasData: false,
  });
  const [selectedRegion, setSelectedRegion] = useState<{
    code: string;
    name: string;
    level: 'sido' | 'sigungu';
  } | null>(null);
  const [voteMessage, setVoteMessage] = useState<string | null>(null);
  const [isSubmittingVote, setIsSubmittingVote] = useState(false);
  const [isVoteCardCollapsed, setIsVoteCardCollapsed] = useState(true);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [voteAfterProfile, setVoteAfterProfile] = useState(false);
  const [isSchoolSearching, setIsSchoolSearching] = useState(false);
  const [schoolResults, setSchoolResults] = useState<SchoolSearchItem[]>([]);
  const [schoolQuery, setSchoolQuery] = useState('');
  const [highlightedSchoolIndex, setHighlightedSchoolIndex] = useState(0);
  const [selectedSchool, setSelectedSchool] = useState<SchoolSearchItem | null>(null);
  const [gpsRegionInput, setGpsRegionInput] = useState<VoteRegionInputByGps | null>(null);
  const [isLocatingRegion, setIsLocatingRegion] = useState(false);
  const [profileModalMessage, setProfileModalMessage] = useState<string | null>(null);
  const [guestHasVoted, setGuestHasVoted] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'map' | 'game' | 'me'>('map');
  const [bottomAdHeight, setBottomAdHeight] = useState(0);
  const [bottomMenuHeight, setBottomMenuHeight] = useState(0);
  const [topicSelectorHeight, setTopicSelectorHeight] = useState(0);
  const [isTopicEditorOpen, setIsTopicEditorOpen] = useState(openTopicEditorOnMount);
  const [activeTopicTab, setActiveTopicTab] = useState<TopicTab>('all');
  const [topicSearchQuery, setTopicSearchQuery] = useState('');
  const statsRequestRef = useRef(0);
  const topicStatsCacheRef = useRef<Record<string, { mapStats: RegionVoteMap; summary: VoteSummary }>>({});
  const bottomDockRef = useRef<HTMLDivElement | null>(null);
  const bottomMenuRef = useRef<HTMLDivElement | null>(null);
  const schoolResultsListRef = useRef<HTMLDivElement | null>(null);
  const topicSelectorRef = useRef<HTMLElement | null>(null);
  const bottomDockHeight = useMemo(() => bottomAdHeight + bottomMenuHeight, [bottomAdHeight, bottomMenuHeight]);

  const topicIdsKey = useMemo(() => initialTopicIds.join(','), [initialTopicIds]);
  const { isAuthenticated, isLoading, profile, signOut, requiresSignupCompletion } = useAuth();
  const guestSessionId = useGuestSessionHeartbeat({ enabled: !isAuthenticated });
  const hasServerRegion = Boolean(profile?.school_id || profile?.sido_code || profile?.sigungu_code);
  const topics = useMemo(() => {
    if (selectedTopicIds.length === 0) {
      return [];
    }

    const byId = new Map(availableTopics.map((topic) => [topic.id, topic]));
    return selectedTopicIds
      .map((topicId) => byId.get(topicId))
      .filter((topic): topic is VoteTopic => Boolean(topic));
  }, [availableTopics, selectedTopicIds]);
  const selectedTopicIdSet = useMemo(() => new Set(selectedTopicIds), [selectedTopicIds]);
  const addableTopics = useMemo(
    () => availableTopics.filter((topic) => !selectedTopicIdSet.has(topic.id)),
    [availableTopics, selectedTopicIdSet],
  );
  const sortedAddableTopics = useMemo(
    () => [...addableTopics].sort((a, b) => KO_TOPIC_COLLATOR.compare(a.title, b.title)),
    [addableTopics],
  );
  const addableTopicsByCategory = useMemo(() => {
    const grouped: Record<TopicCategory, VoteTopic[]> = {
      food: [],
      relationship: [],
      work: [],
      imagination: [],
    };

    sortedAddableTopics.forEach((topic) => {
      grouped[categorizeTopic(topic)].push(topic);
    });

    return grouped;
  }, [sortedAddableTopics]);
  const tabFilteredAddableTopics = useMemo(() => {
    if (activeTopicTab === 'all') {
      return sortedAddableTopics;
    }
    return addableTopicsByCategory[activeTopicTab];
  }, [activeTopicTab, addableTopicsByCategory, sortedAddableTopics]);
  const filteredAddableTopics = useMemo(() => {
    const normalizedQuery = topicSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return tabFilteredAddableTopics;
    }
    return tabFilteredAddableTopics.filter((topic) => topic.title.toLowerCase().includes(normalizedQuery));
  }, [tabFilteredAddableTopics, topicSearchQuery]);

  const activeTopic = useMemo(
    () => topics.find((topic) => topic.id === activeTopicId) ?? null,
    [activeTopicId, topics],
  );
  const optionA = activeTopic?.options.find((option) => option.position === 1) ?? null;
  const optionB = activeTopic?.options.find((option) => option.position === 2) ?? null;
  const selectedOptionLabel = activeTopic?.options.find((option) => option.key === selectedOptionKey)?.label ?? null;
  const isSchoolListVisible = Boolean(
    schoolQuery.trim() && (!selectedSchool || schoolQuery !== selectedSchool.schoolName),
  );
  const hasPendingRegionInput = Boolean(selectedSchool || gpsRegionInput);
  const mapStatsSignature = useMemo(
    () =>
      Object.entries(mapStats)
        .sort(([codeA], [codeB]) => codeA.localeCompare(codeB))
        .map(([code, stat]) => `${code}:${stat.winner ?? 'T'}:${stat.total ?? 0}`)
        .join('|'),
    [mapStats],
  );
  const selectedRegionStat = useMemo(() => {
    if (!selectedRegion) {
      return null;
    }
    return mapStats[selectedRegion.code] ?? null;
  }, [mapStats, selectedRegion]);

  useEffect(() => {
    if (!openTopicEditorOnMount) {
      return;
    }
    setIsTopicEditorOpen(true);
    setActiveTopicTab('all');
    setTopicSearchQuery('');
  }, [openTopicEditorOnMount]);

  const loadRegionStats = useCallback(async (topicId: string) => {
    const requestId = ++statsRequestRef.current;
    setIsStatsLoading(true);
    try {
      const nonce = Date.now();
      const [sidoRes, sigunguRes] = await Promise.allSettled([
        fetch(`/api/votes/region-stats?topicId=${topicId}&level=sido&ts=${nonce}`, { cache: 'no-store' }),
        fetch(`/api/votes/region-stats?topicId=${topicId}&level=sigungu&ts=${nonce}`, { cache: 'no-store' }),
      ]);

      let sidoJson:
        | {
            statsByCode?: RegionVoteMap;
            summary?: { totalVotes: number; countA: number; countB: number };
          }
        | null = null;
      let sigunguJson: { statsByCode?: RegionVoteMap } | null = null;

      if (sidoRes.status === 'fulfilled' && sidoRes.value.ok) {
        sidoJson = (await sidoRes.value.json()) as {
          statsByCode?: RegionVoteMap;
          summary?: { totalVotes: number; countA: number; countB: number };
        };
      }

      if (sigunguRes.status === 'fulfilled' && sigunguRes.value.ok) {
        sigunguJson = (await sigunguRes.value.json()) as { statsByCode?: RegionVoteMap };
      }

      const nextMapStats: RegionVoteMap = {
        ...(sidoJson?.statsByCode ?? {}),
        ...(sigunguJson?.statsByCode ?? {}),
      };
      if (requestId !== statsRequestRef.current) {
        return;
      }
      setMapStats(nextMapStats);

      if (sidoJson?.summary) {
        const normalizedSummary = normalizeSummary(sidoJson.summary);
        setSummary(normalizedSummary);
        topicStatsCacheRef.current[topicId] = {
          mapStats: nextMapStats,
          summary: normalizedSummary,
        };
      } else {
        const normalizedSummary = normalizeSummary({
          totalVotes: 0,
          countA: 0,
          countB: 0,
        });
        setSummary(normalizedSummary);
        topicStatsCacheRef.current[topicId] = {
          mapStats: nextMapStats,
          summary: normalizedSummary,
        };
      }
    } catch {
      if (requestId !== statsRequestRef.current) {
        return;
      }
      const cached = topicStatsCacheRef.current[topicId];
      if (cached) {
        setMapStats(cached.mapStats);
        setSummary(cached.summary);
      } else {
        setSummary(
          normalizeSummary({
            totalVotes: 0,
            countA: 0,
            countB: 0,
          }),
        );
        setMapStats({});
      }
    } finally {
      if (requestId !== statsRequestRef.current) {
        return;
      }
      setIsStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelectedTopicIds(initialTopicIds);
  }, [initialTopicIds, topicIdsKey]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setIsTopicsLoading(true);
      setTopicsError(null);
      try {
        const response = await fetch('/api/votes/topics?status=LIVE', {
          cache: 'no-store',
        });
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

        const validTopicIdSet = new Set(nextTopics.map((topic) => topic.id));
        setAvailableTopics(nextTopics);
        setSelectedTopicIds((prev) => prev.filter((topicId) => validTopicIdSet.has(topicId)));
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
    if (topics.length === 0) {
      setActiveTopicId(null);
      return;
    }

    setActiveTopicId((prev) => (prev && topics.some((topic) => topic.id === prev) ? prev : topics[0].id));
  }, [topics]);

  useEffect(() => {
    if (!activeTopic) {
      setSelectedOptionKey('');
      return;
    }

    setSelectedOptionKey(optionA?.key ?? activeTopic.options[0]?.key ?? '');
    setVoteMessage(null);
  }, [activeTopic, optionA?.key]);

  useEffect(() => {
    if (!activeTopicId) {
      setMapStats({});
      setSummary(
        normalizeSummary({
          totalVotes: 0,
          countA: 0,
          countB: 0,
        }),
      );
      return;
    }

    setSelectedRegion(null);
    const cached = topicStatsCacheRef.current[activeTopicId];
    if (cached) {
      setMapStats(cached.mapStats);
      setSummary(cached.summary);
    } else {
      setMapStats({});
      setSummary(
        normalizeSummary({
          totalVotes: 0,
          countA: 0,
          countB: 0,
        }),
      );
    }
    void loadRegionStats(activeTopicId);
  }, [activeTopicId, loadRegionStats]);

  useEffect(() => {
    if (!activeTopicId) {
      return;
    }

    const handleFocus = () => {
      void loadRegionStats(activeTopicId);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadRegionStats(activeTopicId);
      }
    };
    const handlePageShow = () => {
      void loadRegionStats(activeTopicId);
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [activeTopicId, loadRegionStats]);

  useEffect(() => {
    const storedRegionInput = readPendingRegionInput();
    if (!storedRegionInput) {
      return;
    }

    if (storedRegionInput.source === 'school') {
      setSelectedSchool(storedRegionInput.school);
      setSchoolQuery(storedRegionInput.school.schoolName);
      setGpsRegionInput(null);
      return;
    }

    setGpsRegionInput(storedRegionInput);
  }, []);

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
    const node = topicSelectorRef.current;
    if (!node) {
      return;
    }

    const updateHeight = () => {
      const next = Math.ceil(node.getBoundingClientRect().height);
      setTopicSelectorHeight(next > 0 ? next : 0);
    };

    updateHeight();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(node);
    return () => observer.disconnect();
  }, [isTopicEditorOpen, topics.length]);

  useEffect(() => {
    if (isAuthenticated || !activeTopicId) {
      setGuestHasVoted(false);
      return;
    }

    setGuestHasVoted(readPendingVotes().includes(activeTopicId));
  }, [activeTopicId, isAuthenticated]);

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
    setGpsRegionInput(null);
    setProfileModalMessage(null);
  }, []);

  const buildPendingRegionInput = useCallback((): VoteRegionInput | null => {
    if (selectedSchool) {
      const payload: VoteRegionInput = {
        source: 'school',
        school: selectedSchool,
      };
      writePendingRegionInput(payload);
      return payload;
    }

    if (gpsRegionInput) {
      writePendingRegionInput(gpsRegionInput);
      return gpsRegionInput;
    }

    return null;
  }, [gpsRegionInput, selectedSchool]);

  const resolveOptimisticRegionCodes = useCallback(
    (regionInput: VoteRegionInput | null) => {
      if (regionInput?.source === 'school') {
        return {
          sidoCode: regionInput.school.sidoCode ?? profile?.sido_code ?? null,
          sigunguCode: regionInput.school.sigunguCode ?? profile?.sigungu_code ?? null,
        };
      }

      if (regionInput?.source === 'gps') {
        return {
          sidoCode: regionInput.region.sidoCode ?? profile?.sido_code ?? null,
          sigunguCode: regionInput.region.sigunguCode ?? profile?.sigungu_code ?? null,
        };
      }

      return {
        sidoCode: profile?.sido_code ?? null,
        sigunguCode: profile?.sigungu_code ?? null,
      };
    },
    [profile?.sido_code, profile?.sigungu_code],
  );

  const handleUseCurrentLocation = useCallback(async () => {
    setIsLocatingRegion(true);
    setProfileModalMessage(null);

    try {
      const nextGpsRegionInput = await resolveVoteRegionInputFromCurrentLocation();
      setGpsRegionInput(nextGpsRegionInput);
      setSelectedSchool(null);
      setSchoolQuery('');
      writePendingRegionInput(nextGpsRegionInput);
      setProfileModalMessage('정확한 위치 확인이 완료되었습니다.');
    } catch (error) {
      const message = error instanceof Error ? error.message : '위치 정보를 확인하지 못했습니다.';
      setProfileModalMessage(message);
    } finally {
      setIsLocatingRegion(false);
    }
  }, []);

  const handleClearGpsRegion = useCallback(() => {
    setGpsRegionInput(null);
    setProfileModalMessage(null);
  }, []);

  const submitVote = useCallback(
    async (regionInputPayload: VoteRegionInput | null) => {
      if (!activeTopicId || !selectedOptionKey || !optionA || !optionB) {
        return;
      }

      setIsSubmittingVote(true);
      setVoteMessage(null);

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
            topicId: activeTopicId,
            optionKey: selectedOptionKey,
            guestSessionId: isAuthenticated ? undefined : guestSessionId,
            ...(regionInputPayload ? { regionInput: regionInputPayload } : {}),
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
          addPendingVoteTopic(activeTopicId);
          setGuestHasVoted(true);
        }

        const optimisticRegion = resolveOptimisticRegionCodes(regionInputPayload);
        const optimisticSidoCode = optimisticRegion.sidoCode;
        const optimisticSigunguCode = optimisticRegion.sigunguCode;

        if (optimisticSidoCode || optimisticSigunguCode) {
          setMapStats((prev) => {
            let next = prev;
            if (optimisticSidoCode) {
              next = bumpRegionStat(next, optimisticSidoCode, selectedOptionKey, optionA.key, optionB.key);
            }
            if (optimisticSigunguCode) {
              next = bumpRegionStat(next, optimisticSigunguCode, selectedOptionKey, optionA.key, optionB.key);
            }
            return next;
          });

          setSummary((prev) =>
            normalizeSummary({
              totalVotes: prev.totalVotes + 1,
              countA: prev.countA + (selectedOptionKey === optionA.key ? 1 : 0),
              countB: prev.countB + (selectedOptionKey === optionB.key ? 1 : 0),
            }),
          );
        }

        setVoteMessage('투표가 반영되었습니다.');
        router.push(`/results/${activeTopicId}`);
        return;
      } catch {
        setVoteMessage('투표 처리 중 오류가 발생했습니다.');
      } finally {
        setIsSubmittingVote(false);
      }
    },
    [
      activeTopicId,
      guestSessionId,
      isAuthenticated,
      optionA,
      optionB,
      resolveOptimisticRegionCodes,
      router,
      selectedOptionKey,
    ],
  );

  const handleVote = useCallback(async () => {
    if (isAuthenticated && requiresSignupCompletion) {
      setVoteMessage(SIGNUP_COMPLETION_REQUIRED_MESSAGE);
      router.push('/auth/complete-signup');
      return;
    }

    const payload = buildPendingRegionInput();
    if (payload) {
      await submitVote(payload);
      return;
    }

    if (isAuthenticated && hasServerRegion) {
      await submitVote(null);
      return;
    }

    setProfileModalMessage(null);
    setVoteAfterProfile(true);
    setShowProfileModal(true);
  }, [
    buildPendingRegionInput,
    hasServerRegion,
    isAuthenticated,
    requiresSignupCompletion,
    router,
    submitVote,
  ]);

  const handleSaveRegionOnly = useCallback(async () => {
    const payload = buildPendingRegionInput();
    if (!payload) {
      setVoteMessage(REGION_MODAL_HINT);
      return;
    }

    setShowProfileModal(false);
    if (voteAfterProfile) {
      setVoteAfterProfile(false);
      await submitVote(payload);
    } else {
      setVoteMessage('지역 정보가 저장되었습니다.');
    }
  }, [buildPendingRegionInput, submitVote, voteAfterProfile]);

  const handleAddTopic = useCallback((topicId: string) => {
    setSelectedTopicIds((prev) => (prev.includes(topicId) ? prev : [...prev, topicId]));
    setActiveTopicId(topicId);
    setTopicSearchQuery('');
    setTopicsError(null);
  }, []);

  const handleRemoveTopic = useCallback((topicId: string) => {
    setSelectedTopicIds((prev) => prev.filter((id) => id !== topicId));
    setTopicsError(null);
  }, []);

  const handleBottomTabClick = useCallback(
    (tab: 'home' | 'map' | 'game' | 'me') => {
      if (tab === 'home') {
        router.push('/');
        return;
      }
      if (tab === 'game') {
        router.push('/game');
        return;
      }
      if (tab === 'me') {
        if (typeof window !== 'undefined' && window.location.pathname === '/my') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        router.push('/my');
        if (typeof window !== 'undefined') {
          window.setTimeout(() => {
            if (window.location.pathname !== '/my') {
              window.location.assign('/my');
            }
          }, 120);
        }
        return;
      }
      setActiveTab(tab);
    },
    [router],
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (selectedTopicIds.length > 0) {
      params.set('topics', selectedTopicIds.join(','));
    } else {
      params.delete('topics');
    }

    const nextQuery = params.toString();
    const currentQuery = window.location.search.replace(/^\?/, '');
    if (nextQuery === currentQuery) {
      return;
    }

    window.history.replaceState(window.history.state, '', nextQuery ? `/topics-map?${nextQuery}` : '/topics-map');
  }, [selectedTopicIds]);

  return (
    <div className="bg-black text-white">
      <main className="relative h-screen w-full overflow-hidden bg-black text-white [font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text','SF_Pro_Display','Segoe_UI',sans-serif]">
      <div className="absolute inset-0">
        <KoreaAdminMap
          key={`${activeTopicId ?? 'topics-map-empty'}-${mapStatsSignature}`}
          statsByCode={mapStats}
          height="100%"
          initialCenter={TOPICS_MAP_INITIAL_CENTER}
          initialZoom={6}
          bottomDockHeightPx={bottomDockHeight}
          toggleClearancePx={Math.max(22, topicSelectorHeight + TOPIC_SELECTOR_STACK_GAP_PX * 2)}
          theme="dark"
          showNavigationControl={false}
          showTooltip={false}
          showRegionLevelToggle
          regionLevelToggleAlign="right"
          colors={TOPICS_MAP_COLORS}
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
        className="pointer-events-none relative z-20 mx-auto flex h-full w-full max-w-[430px] flex-col px-4 pt-[calc(0.7rem+env(safe-area-inset-top))]"
        style={{ paddingBottom: `${bottomDockHeight + TOPIC_SELECTOR_STACK_GAP_PX}px` }}
      >
        {isTopicsLoading ? (
          <section className="pointer-events-auto mt-3 rounded-[22px] border border-white/12 bg-[rgba(20,20,24,0.62)] px-4 py-4 text-sm text-white/75 shadow-[0_8px_24px_rgba(0,0,0,0.3)] backdrop-blur-2xl">
            주제 목록 불러오는 중...
          </section>
        ) : (
          <>
            {topics.length === 0 ? (
              <section className="pointer-events-auto mt-3 rounded-[22px] border border-white/12 bg-[rgba(20,20,24,0.62)] px-4 py-4 shadow-[0_8px_24px_rgba(0,0,0,0.3)] backdrop-blur-2xl">
                <h2 className="text-lg font-semibold text-white">선택된 주제가 없습니다.</h2>
                <p className="mt-2 text-sm text-white/70">하단의 주제 선택에서 원하는 LIVE 주제를 담아주세요.</p>
              </section>
            ) : (
              <>
                <LiveVoteCard
                  className="mt-3 shrink-0"
                  topicId={activeTopic?.id ?? null}
                  title={activeTopic?.title ?? '주제 없음'}
                  isExpanded={!isVoteCardCollapsed}
                  onToggleExpanded={() => setIsVoteCardCollapsed((prev) => !prev)}
                  selectedOptionKey={selectedOptionKey || null}
                  onSelectOption={setSelectedOptionKey}
                  onSubmitVote={() => void handleVote()}
                  submitDisabled={
                    isSubmittingVote ||
                    !selectedOptionKey ||
                    (!isAuthenticated && guestHasVoted) ||
                    (!isAuthenticated && !guestSessionId)
                  }
                  submitLabel={
                    isSubmittingVote
                      ? '처리 중...'
                      : !isAuthenticated && guestHasVoted
                        ? '이미 투표 완료'
                        : `${selectedOptionLabel ?? '선택한 항목'}에 투표하기`
                  }
                  message={voteMessage}
                  isStatsLoading={isStatsLoading}
                  totalVotes={summary.totalVotes}
                  leftOption={{
                    key: optionA?.key ?? null,
                    label: optionA?.label ?? '선택지 A',
                    percentage: summary.hasData ? summary.aPercent : null,
                    subtext: getOptionSubtext(activeTopic?.id, optionA?.key ?? null),
                  }}
                  rightOption={{
                    key: optionB?.key ?? null,
                    label: optionB?.label ?? '선택지 B',
                    percentage: summary.hasData ? summary.bPercent : null,
                    subtext: getOptionSubtext(activeTopic?.id, optionB?.key ?? null),
                  }}
                  auth={{
                    isLoading,
                    isAuthenticated,
                    avatarUrl: profile?.avatar_url ?? null,
                    displayInitial: (profile?.nickname ?? profile?.full_name ?? profile?.email ?? 'U').slice(0, 1),
                    onSignOut: signOut,
                  }}
                />

                {selectedRegion ? (
                  <section className="pointer-events-auto mt-3 shrink-0 rounded-[22px] border border-white/12 bg-[rgba(18,18,22,0.62)] p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.3)] backdrop-blur-2xl">
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
                              <span>{optionA?.label ?? 'A'} {aPercent}%</span>
                              <span>{optionB?.label ?? 'B'} {bPercent}%</span>
                            </div>
                            <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-white/10">
                              <div className="h-full bg-[#ff6b00]" style={{ width: `${aPercent}%` }} />
                              <div className="h-full bg-[#2f74ff]" style={{ width: `${bPercent}%` }} />
                            </div>
                            <p className="mt-2 text-[12px] text-white/65">
                              참여 {total.toLocaleString()}표 · {optionA?.label ?? 'A'} {countA.toLocaleString()} ·{' '}
                              {optionB?.label ?? 'B'} {countB.toLocaleString()}
                            </p>
                          </div>
                        );
                      })()
                    ) : (
                      <p className="mt-2 text-[12px] text-white/60">이 지역에는 아직 투표 데이터가 없습니다.</p>
                    )}
                  </section>
                ) : null}
              </>
            )}

            <div className="flex-1" />

            <section
              ref={topicSelectorRef}
              className="pointer-events-auto mt-3 w-full rounded-t-[32px] border-t border-white/12 bg-[rgba(20,20,24,0.78)] pb-3 shadow-[0_-10px_40px_rgba(0,0,0,0.6)] backdrop-blur-2xl"
            >
              <div className="mx-auto mb-2 mt-3.5 h-1.5 w-12 rounded-full bg-white/20" />

              <div className="flex items-center justify-between px-6 pb-5 pt-3">
                <h3 className="text-[20px] font-bold tracking-tight text-white">
                  선택 주제 태그{' '}
                  <span className="ml-1 text-[14px] font-medium text-white/55">{topics.length}개</span>
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setIsTopicEditorOpen((prev) => !prev);
                    setActiveTopicTab('all');
                    setTopicSearchQuery('');
                  }}
                  className="text-[15px] font-semibold text-white/72 transition-colors hover:text-[#ffd29c]"
                >
                  {isTopicEditorOpen ? '닫기' : '열기'}
                </button>
              </div>

              <div className="mb-5 px-5">
                <div className="flex min-h-[72px] flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/12 bg-[rgba(8,10,14,0.88)] p-2.5">
                <AnimatePresence mode="popLayout" initial={false}>
                  {topics.length === 0 ? (
                    <motion.div
                      key="empty-topics"
                      initial={shouldReduceMotion ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={shouldReduceMotion ? undefined : { opacity: 0 }}
                      className="flex w-full flex-col items-center justify-center py-1 text-center text-white/60"
                    >
                      <p className="text-[14px] font-medium text-white/80">선택된 주제가 없습니다</p>
                      <p className="mt-1 text-[12px] text-white/52">아래 목록에서 원하는 LIVE 주제를 담아주세요</p>
                    </motion.div>
                  ) : (
                    <motion.div key="selected-topic-chips" layout className="flex w-full flex-wrap gap-2">
                      {topics.map((topic) => {
                        const active = topic.id === activeTopicId;
                        return (
                          <motion.div
                            key={topic.id}
                            layout
                            initial={shouldReduceMotion ? false : { scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={shouldReduceMotion ? undefined : { scale: 0.8, opacity: 0 }}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] ${
                              active
                                ? 'border-[#ff9f0a66] bg-[#ff6b0028] text-[#ffcc99]'
                                : 'border-white/16 bg-white/8 text-white/84'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => setActiveTopicId(topic.id)}
                              className="max-w-[11.5rem] truncate text-left font-bold"
                              aria-label={`${topic.title} 선택`}
                            >
                              {topic.title}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveTopic(topic.id)}
                              className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] transition-colors ${
                                active
                                  ? 'bg-[#ff9f0a33] text-[#ffd5ad] hover:bg-[#ff9f0a40]'
                                  : 'bg-white/15 text-white/75 hover:bg-white/20 hover:text-white'
                              }`}
                              aria-label={`${topic.title} 제거`}
                            >
                              ✕
                            </button>
                          </motion.div>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              </div>

              {isTopicEditorOpen ? (
                <>
                  <div className="mb-5 px-5">
                    <div className="flex h-[44px] items-center gap-2 rounded-xl border border-white/14 bg-white/8 px-3 transition-colors focus-within:border-[#ff9f0a66]">
                    <span aria-hidden className="text-base text-white/55">
                      🔍
                    </span>
                    <input
                      type="text"
                      value={topicSearchQuery}
                      onChange={(event) => setTopicSearchQuery(event.target.value)}
                      placeholder="추가할 주제를 검색하세요"
                      className="w-full bg-transparent text-[15px] text-white outline-none placeholder:text-white/45"
                    />
                    {topicSearchQuery ? (
                      <button
                        type="button"
                        onClick={() => setTopicSearchQuery('')}
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/15 text-[10px] text-white/70 transition hover:bg-white/22 hover:text-white"
                        aria-label="검색어 지우기"
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                  </div>

                  <div className="border-b border-white/10 px-5">
                    <div className="hide-scrollbar flex gap-5 overflow-x-auto scroll-smooth">
                      {TOPIC_TAB_META.map((tab) => {
                        const isActive = activeTopicTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTopicTab(tab.id)}
                            className="relative whitespace-nowrap pb-3 text-[15px] font-medium transition-colors"
                          >
                            <span className={isActive ? 'font-bold text-white' : 'text-white/56'}>{tab.label}</span>
                            {isActive ? (
                              <motion.div
                                layoutId="topic-selector-active-tab"
                                className="absolute bottom-0 left-0 right-0 h-[2.5px] rounded-t-full bg-white"
                              />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="custom-scrollbar max-h-52 overflow-y-auto px-5 pb-8 pt-2">
                    <AnimatePresence initial={false}>
                      {filteredAddableTopics.length === 0 ? (
                        <motion.p
                          key="empty-addable-topics"
                          initial={shouldReduceMotion ? false : { opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={shouldReduceMotion ? undefined : { opacity: 0 }}
                          className="py-10 text-center text-[14px] text-white/58"
                        >
                          일치하는 주제가 없습니다.
                        </motion.p>
                      ) : (
                        <motion.div key="addable-topics-list" layout>
                          {filteredAddableTopics.map((topic) => (
                            <motion.div
                              key={topic.id}
                              layout
                              initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.95 }}
                              className="group flex items-center justify-between border-b border-white/8 py-4"
                            >
                              <span className="line-clamp-2 text-[16px] font-medium text-white/90 transition-colors group-hover:text-white">
                                {topic.title}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleAddTopic(topic.id)}
                                className="shrink-0 rounded-full border border-[#ff9f0a55] bg-[#ff6b0025] px-4 py-1.5 text-[13px] font-bold tracking-wide text-[#ffcc99] transition-all hover:bg-[#ff6b0036] active:scale-95"
                              >
                                추가
                              </button>
                            </motion.div>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </>
              ) : null}

              {topicsError ? <p className="px-5 pt-2 text-xs text-[#ffb4b4]">{topicsError}</p> : null}
            </section>

            <div className="h-0" />
          </>
        )}
      </div>

      <div ref={bottomDockRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-30 md:hidden">
        <section className="pointer-events-auto border-t border-white/14 bg-[rgba(12,18,28,0.82)] pb-[calc(0.55rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
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
        className="pointer-events-none absolute inset-x-0 z-20 md:hidden"
        style={{ bottom: `${bottomAdHeight}px` }}
      >
        <nav className="pointer-events-auto rounded-t-[24px] border-t border-white/14 bg-[rgba(12,18,28,0.82)] pb-2 pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
          <div className="mx-auto grid max-w-[430px] grid-cols-4 gap-2 px-3">
            {[
              { id: 'home' as const, label: '홈' },
              { id: 'map' as const, label: '지도' },
              { id: 'game' as const, label: '게임' },
              { id: 'me' as const, label: 'MY' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
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

      {showProfileModal ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/55 p-4 sm:items-center">
          <div className="w-full max-w-[430px] rounded-[28px] border border-white/12 bg-[rgba(22,22,26,0.95)] p-5 shadow-2xl backdrop-blur-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-[20px] font-semibold text-white">최초 투표 지역 입력</h4>
              <button
                type="button"
                onClick={() => {
                  setShowProfileModal(false);
                  setVoteAfterProfile(false);
                  setProfileModalMessage(null);
                }}
                className="rounded-lg px-2 py-1 text-sm text-white/65 hover:bg-white/10 hover:text-white"
              >
                닫기
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-sm leading-relaxed text-white/72">{REGION_MODAL_HINT}</p>

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
                    setProfileModalMessage(null);
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
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-[11px] font-medium text-[#ffcc99]">선택됨: {selectedSchool.schoolName}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSchool(null);
                        setSchoolQuery('');
                        setProfileModalMessage(null);
                      }}
                      className="rounded-md border border-white/15 bg-white/8 px-2 py-0.5 text-[11px] text-white/75 transition hover:bg-white/12"
                    >
                      학교 선택 해제
                    </button>
                  </div>
                ) : null}
              </label>

              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-white/14" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/55">또는</span>
                <div className="h-px flex-1 bg-white/14" />
              </div>

              <div className="space-y-2 rounded-xl border border-white/12 bg-white/5 p-3">
                <button
                  type="button"
                  onClick={() => void handleUseCurrentLocation()}
                  disabled={isLocatingRegion}
                  className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-white/18 bg-white/8 px-3 text-sm font-semibold text-white transition hover:bg-white/14 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isLocatingRegion ? '위치 확인 중...' : '정확한 위치 사용'}
                </button>

                {gpsRegionInput ? (
                  <div className="flex items-center justify-between gap-2 text-[11px] text-[#9dd2ff]">
                    <p className="truncate">
                      선택됨: {gpsRegionInput.region.sidoName ?? gpsRegionInput.region.sidoCode}
                      {gpsRegionInput.region.sigunguName
                        ? ` · ${gpsRegionInput.region.sigunguName}`
                        : gpsRegionInput.region.sigunguCode
                          ? ` · ${gpsRegionInput.region.sigunguCode}`
                          : ''}
                    </p>
                    <button
                      type="button"
                      onClick={handleClearGpsRegion}
                      className="rounded-md border border-white/15 bg-white/8 px-2 py-0.5 text-[11px] text-white/75 transition hover:bg-white/12"
                    >
                      위치 선택 해제
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-white/58">위치 허용 시 시/도·시군구 코드만 저장합니다.</p>
                )}
              </div>

              {profileModalMessage ? (
                <p className="rounded-lg border border-white/12 bg-white/6 px-3 py-2 text-xs text-white/78">
                  {profileModalMessage}
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => void handleSaveRegionOnly()}
                disabled={!hasPendingRegionInput || isLocatingRegion}
                className="inline-flex h-12 w-full items-center justify-center rounded-2xl border border-[#ff9f0a66] bg-[#ff6b00] text-[15px] font-bold text-white shadow-[0_8px_24px_rgba(255,107,0,0.35)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                저장{voteAfterProfile ? ' 후 투표하기' : ''}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      </main>

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
