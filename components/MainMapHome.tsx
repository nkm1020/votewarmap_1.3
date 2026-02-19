'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { SearchIcon } from 'lucide-react';
import type { RegionVoteMap } from '@/components/KoreaAdminMap';
import { useAuth } from '@/contexts/AuthContext';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  addPendingVoteTopic,
  getOrCreateGuestToken,
  readPendingProfile,
  readPendingVotes,
  writePendingProfile,
} from '@/lib/vote/client-storage';
import {
  LOCAL_STORAGE_KEYS,
  POPULAR_OPTION_A,
  POPULAR_OPTION_B,
  POPULAR_TOPIC_ID,
} from '@/lib/vote/constants';
import type { Gender, SchoolSearchItem, VoteProfileInput, VoteTopic } from '@/lib/vote/types';
import { TagSelector } from '@/components/ui/tag-selector';

const KoreaAdminMap = dynamic(() => import('@/components/KoreaAdminMap'), { ssr: false });

const POPULAR_VOTE_FALLBACK = {
  status: 'LIVE',
  title: '서울 vs 부산 교통 개편안',
  teamA: '서울',
  teamB: '부산',
};

const MAIN_INITIAL_CENTER: [number, number] = [127.75, 36.18];
const MAIN_INITIAL_ZOOM = 6.0;
const MAIN_MAP_COLORS = {
  a: 'rgba(255, 90, 0, 0.95)',
  b: 'rgba(30, 120, 255, 0.95)',
  tie: 'rgba(255, 193, 63, 0.95)',
  neutral: 'rgba(42, 34, 30, 0.18)',
} as const;
const TOPIC_SELECTION_LIMIT = 10;
const GENDER_OPTIONS: Array<{ value: Gender; label: string }> = [
  { value: 'male', label: '남성' },
  { value: 'female', label: '여성' },
];

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
  optionKey: 'seoul' | 'busan',
): RegionVoteMap {
  if (!regionCode) {
    return prev;
  }

  const next = { ...prev };
  const current = next[regionCode] ?? { total: 0, countA: 0, countB: 0, winner: 'TIE' as const };
  const countA = (current.countA ?? 0) + (optionKey === POPULAR_OPTION_A ? 1 : 0);
  const countB = (current.countB ?? 0) + (optionKey === POPULAR_OPTION_B ? 1 : 0);
  const total = (current.total ?? 0) + 1;
  const winner = countA > countB ? 'A' : countB > countA ? 'B' : 'TIE';

  next[regionCode] = { countA, countB, total, winner };
  return next;
}

function readCachedRegionState(): {
  statsByCode: RegionVoteMap;
  summary: { totalVotes: number; countA: number; countB: number };
} | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEYS.cachedRegionStatsPopular);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as {
      statsByCode?: RegionVoteMap;
      summary?: { totalVotes: number; countA: number; countB: number };
    };
    if (!parsed.statsByCode || !parsed.summary) {
      return null;
    }

    return {
      statsByCode: parsed.statsByCode,
      summary: parsed.summary,
    };
  } catch {
    return null;
  }
}

function writeCachedRegionState(payload: {
  statsByCode: RegionVoteMap;
  summary: { totalVotes: number; countA: number; countB: number };
}): void {
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
  const [isStatsLoading, setIsStatsLoading] = useState(true);
  const [summary, setSummary] = useState({
    totalVotes: 0,
    countA: 0,
    countB: 0,
    aPercent: 0,
    bPercent: 0,
    hasData: false,
  });
  const [selectedOption, setSelectedOption] = useState<'seoul' | 'busan'>(POPULAR_OPTION_A);
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
  const [guestToken, setGuestToken] = useState<string | null>(null);
  const [guestHasVoted, setGuestHasVoted] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<{
    code: string;
    name: string;
    level: 'sido' | 'sigungu';
  } | null>(null);
  const [isTopicSheetOpen, setIsTopicSheetOpen] = useState(false);
  const [availableTopics, setAvailableTopics] = useState<VoteTopic[]>([]);
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [isTopicsLoading, setIsTopicsLoading] = useState(false);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [bottomDockHeight, setBottomDockHeight] = useState(124);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const bottomDockRef = useRef<HTMLDivElement | null>(null);

  const { isAuthenticated, isLoading, profile, user, signOut } = useAuth();
  const hasServerProfile = Boolean(profile?.birth_year && profile?.gender && profile?.school_id);

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
  const selectedTopicTags = useMemo(
    () => availableTopics.filter((topic) => selectedTopicIds.includes(topic.id)),
    [availableTopics, selectedTopicIds],
  );

  const loadRegionStats = useCallback(async () => {
    setIsStatsLoading(true);
    try {
      const nonce = Date.now();
      const [sidoRes, sigunguRes] = await Promise.allSettled([
        fetch(`/api/votes/region-stats?topicId=${POPULAR_TOPIC_ID}&level=sido&ts=${nonce}`, { cache: 'no-store' }),
        fetch(`/api/votes/region-stats?topicId=${POPULAR_TOPIC_ID}&level=sigungu&ts=${nonce}`, { cache: 'no-store' }),
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
      setMapStats(nextMapStats);

      if (sidoJson?.summary) {
        setSummary(normalizeSummary(sidoJson.summary));
        writeCachedRegionState({
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
    const handleFocus = () => {
      void loadRegionStats();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadRegionStats();
      }
    };
    const handlePageShow = () => {
      void loadRegionStats();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [loadRegionStats]);

  useEffect(() => {
    const token = getOrCreateGuestToken();
    setGuestToken(token);

    const cachedRegionState = readCachedRegionState();
    if (cachedRegionState) {
      setMapStats(cachedRegionState.statsByCode);
      setSummary(normalizeSummary(cachedRegionState.summary));
      setIsStatsLoading(false);
    }

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

    if (readPendingVotes().includes(POPULAR_TOPIC_ID)) {
      setGuestHasVoted(true);
    }
  }, [profile?.birth_year, profile?.gender]);

  useEffect(() => {
    void loadRegionStats();
  }, [loadRegionStats]);

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

      try {
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
            topicId: POPULAR_TOPIC_ID,
            optionKey: selectedOption,
            guestToken: isAuthenticated ? undefined : guestToken,
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
          addPendingVoteTopic(POPULAR_TOPIC_ID);
          setGuestHasVoted(true);
        }

        const optimisticSidoCode = profilePayload?.school.sidoCode ?? profile?.sido_code ?? null;
        const optimisticSigunguCode = profilePayload?.school.sigunguCode ?? profile?.sigungu_code ?? null;

        if (optimisticSidoCode || optimisticSigunguCode) {
          let optimisticMap = mapStats;
          if (optimisticSidoCode) {
            optimisticMap = bumpRegionStat(optimisticMap, optimisticSidoCode, selectedOption);
          }
          if (optimisticSigunguCode) {
            optimisticMap = bumpRegionStat(optimisticMap, optimisticSigunguCode, selectedOption);
          }

          const optimisticSummary = {
            totalVotes: summary.totalVotes + 1,
            countA: summary.countA + (selectedOption === POPULAR_OPTION_A ? 1 : 0),
            countB: summary.countB + (selectedOption === POPULAR_OPTION_B ? 1 : 0),
          };

          writeCachedRegionState({
            statsByCode: optimisticMap,
            summary: optimisticSummary,
          });

          setMapStats((prev) => {
            let next = prev;
            if (optimisticSidoCode) {
              next = bumpRegionStat(next, optimisticSidoCode, selectedOption);
            }
            if (optimisticSigunguCode) {
              next = bumpRegionStat(next, optimisticSigunguCode, selectedOption);
            }
            return next;
          });

          setSummary((prev) =>
            normalizeSummary({
              totalVotes: prev.totalVotes + 1,
              countA: prev.countA + (selectedOption === POPULAR_OPTION_A ? 1 : 0),
              countB: prev.countB + (selectedOption === POPULAR_OPTION_B ? 1 : 0),
            }),
          );
        }

        setVoteMessage('투표가 반영되었습니다.');
        await loadRegionStats();
      } catch {
        setVoteMessage('투표 처리 중 오류가 발생했습니다.');
      } finally {
        setIsSubmittingVote(false);
      }
    },
    [
      guestToken,
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
  }, [hasServerProfile, isAuthenticated, savePendingProfile, submitVote]);

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

  const loadAvailableTopics = useCallback(async () => {
    if (isTopicsLoading) {
      return;
    }

    setIsTopicsLoading(true);
    setTopicsError(null);
    try {
      const response = await fetch('/api/votes/topics?status=LIVE', { cache: 'no-store' });
      const json = (await response.json()) as { topics?: VoteTopic[]; error?: string };
      if (!response.ok) {
        setTopicsError(json.error ?? '주제 목록을 불러오지 못했습니다.');
        return;
      }

      setAvailableTopics(json.topics ?? []);
    } catch {
      setTopicsError('주제 목록을 불러오지 못했습니다.');
    } finally {
      setIsTopicsLoading(false);
    }
  }, [isTopicsLoading]);

  const handleOpenTopicSheet = useCallback(() => {
    setIsTopicSheetOpen(true);
    if (availableTopics.length === 0) {
      void loadAvailableTopics();
    }
  }, [availableTopics.length, loadAvailableTopics]);

  const handleTopicTagsChange = useCallback((topics: VoteTopic[]) => {
    if (topics.length > TOPIC_SELECTION_LIMIT) {
      setTopicsError(`주제는 최대 ${TOPIC_SELECTION_LIMIT}개까지 선택할 수 있습니다.`);
      return;
    }

    setTopicsError(null);
    setSelectedTopicIds(topics.map((topic) => topic.id));
  }, []);

  const handleTopicSelectionComplete = useCallback(() => {
    if (selectedTopicIds.length === 0) {
      return;
    }

    const params = new URLSearchParams({ topics: selectedTopicIds.join(',') });
    setIsTopicSheetOpen(false);
    router.push(`/topics-map?${params.toString()}`);
  }, [router, selectedTopicIds]);

  return (
    <main className="relative h-screen w-full overflow-hidden bg-black text-white [font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text','SF_Pro_Display','Segoe_UI',sans-serif]">
      <div className="absolute inset-0">
        <KoreaAdminMap
          statsByCode={mergedMapStats}
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
        <header className="pointer-events-auto">
          <div className="flex items-center gap-2 rounded-[20px] border border-white/20 bg-[rgba(12,18,28,0.72)] px-3 py-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.3)] backdrop-blur-2xl">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/18 bg-white/10">
              <SearchIcon className="h-4 w-4 text-white/75" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-white/88">대한민국 실시간 투표 지도</p>
              <p className="truncate text-[12px] text-white/58">{POPULAR_VOTE_FALLBACK.title}</p>
            </div>
            {isLoading ? (
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-[11px] font-semibold text-white/75">
                ...
              </span>
            ) : isAuthenticated ? (
              <div ref={profileMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setIsProfileMenuOpen((prev) => !prev)}
                  aria-label="내 계정 메뉴"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white/90 transition hover:bg-white/15"
                >
                  {profile?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profile.avatar_url}
                      alt="프로필"
                      className="h-8 w-8 rounded-full border border-white/30 object-cover"
                    />
                  ) : (
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/30 bg-white/10 text-[11px] font-bold">
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
                      className="inline-flex h-9 w-full items-center justify-center rounded-lg text-[13px] font-semibold text-white/85 transition hover:bg-white/10 hover:text-white"
                    >
                      로그아웃
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <Link
                href="/auth"
                className="inline-flex h-11 items-center rounded-full border border-white/20 bg-white/10 px-4 text-[12px] font-semibold text-white transition hover:bg-white/20"
              >
                로그인
              </Link>
            )}
          </div>
        </header>

        <motion.section
          layout
          transition={cardLayoutTransition}
          className={`pointer-events-auto mt-3 shrink-0 overflow-hidden border bg-[rgba(12,18,28,0.78)] shadow-[0_14px_32px_rgba(0,0,0,0.34)] backdrop-blur-2xl ${
            isVoteCardCollapsed
              ? 'rounded-[20px] border-white/14 p-3'
              : 'rounded-[26px] border-white/18 p-4'
          }`}
        >
          <motion.div
            initial={false}
            animate={{
              opacity: isVoteCardCollapsed ? 1 : 0,
              height: isVoteCardCollapsed ? 'auto' : 0,
              y: isVoteCardCollapsed ? 0 : prefersReducedMotion ? 0 : -6,
            }}
            transition={cardTransition}
            className="overflow-hidden"
            style={{ pointerEvents: isVoteCardCollapsed ? 'auto' : 'none' }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#ff9f0a]">
                  실시간 인기 투표
                </p>
                <p className="truncate text-[14px] font-semibold text-white/92">{POPULAR_VOTE_FALLBACK.title}</p>
              </div>
                <button
                  type="button"
                  onClick={() => setIsVoteCardCollapsed(false)}
                  className="inline-flex h-11 items-center rounded-xl border border-white/20 bg-white/10 px-4 text-[12px] font-semibold text-white hover:bg-white/15"
                >
                  펼치기
                </button>
            </div>
            <div className="mt-2.5">
              <div className="relative h-2.5 overflow-hidden rounded-full bg-white/14">
                {summary.hasData ? (
                  <>
                    <div
                      className="absolute inset-y-0 left-0 rounded-r-full bg-[#ff6b00]"
                      style={{ width: `${summary.aPercent}%` }}
                    />
                    <div
                      className="absolute inset-y-0 right-0 rounded-l-full bg-[#2f74ff]"
                      style={{ width: `${summary.bPercent}%` }}
                    />
                  </>
                ) : (
                  <div className="absolute inset-0 bg-white/8" />
                )}
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={false}
            animate={{
              opacity: isVoteCardCollapsed ? 0 : 1,
              height: isVoteCardCollapsed ? 0 : 'auto',
              y: isVoteCardCollapsed ? (prefersReducedMotion ? 0 : 6) : 0,
            }}
            transition={cardTransition}
            className="overflow-hidden"
            style={{ pointerEvents: isVoteCardCollapsed ? 'none' : 'auto' }}
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-white">실시간 인기 투표</h2>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-[#ff9f0a66] bg-[#ff9f0a22] px-3 py-1 text-[12px] font-semibold text-[#ff9f0a]">
                  {POPULAR_VOTE_FALLBACK.status}
                </span>
                <button
                  type="button"
                  onClick={() => setIsVoteCardCollapsed(true)}
                  className="inline-flex h-11 items-center rounded-lg border border-white/20 bg-white/10 px-3 text-[12px] font-semibold text-white/80 hover:bg-white/15"
                >
                  최소화
                </button>
              </div>
            </div>

            <h3 className="text-[20px] font-semibold leading-tight text-white">{POPULAR_VOTE_FALLBACK.title}</h3>
            <p className="mt-1.5 text-[15px] text-white/62">
              {isStatsLoading
                ? '집계 불러오는 중...'
                : `총 ${summary.totalVotes.toLocaleString()}표 참여`}
            </p>

            <div className="mt-4 space-y-3 text-[15px]">
              <div className="flex items-center justify-between text-white/88">
                <span className="font-semibold">{POPULAR_VOTE_FALLBACK.teamA}</span>
                <span className="font-semibold">{POPULAR_VOTE_FALLBACK.teamB}</span>
              </div>

              <div className="relative h-5 overflow-hidden rounded-full bg-white/14">
                {summary.hasData ? (
                  <>
                    <div
                      className="absolute inset-y-0 left-0 rounded-r-full bg-[#ff6b00] shadow-[0_0_18px_rgba(255,107,0,0.45)]"
                      style={{ width: `${summary.aPercent}%` }}
                    />
                    <div
                      className="absolute inset-y-0 right-0 rounded-l-full bg-[#2f74ff] shadow-[0_0_18px_rgba(47,116,255,0.4)]"
                      style={{ width: `${summary.bPercent}%` }}
                    />
                  </>
                ) : (
                  <div className="absolute inset-0 bg-white/8" />
                )}
              </div>

              <div className="flex items-center justify-between text-[14px]">
                <span className="font-semibold text-[#ffb784]">
                  {summary.hasData ? `${summary.aPercent}%` : '-'}
                </span>
                <span className="font-semibold text-[#9cbcff]">
                  {summary.hasData ? `${summary.bPercent}%` : '-'}
                </span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSelectedOption(POPULAR_OPTION_A)}
                className={`inline-flex h-11 items-center justify-center rounded-xl border text-[14px] font-semibold transition ${
                  selectedOption === POPULAR_OPTION_A
                    ? 'border-[#ff9f0a88] bg-[#ff6b0030] text-[#ffbf88]'
                    : 'border-white/15 bg-white/5 text-white/80 hover:bg-white/10'
                }`}
              >
                서울 선택
              </button>
              <button
                type="button"
                onClick={() => setSelectedOption(POPULAR_OPTION_B)}
                className={`inline-flex h-11 items-center justify-center rounded-xl border text-[14px] font-semibold transition ${
                  selectedOption === POPULAR_OPTION_B
                    ? 'border-[#7fb0ff88] bg-[#2f74ff30] text-[#b8d2ff]'
                    : 'border-white/15 bg-white/5 text-white/80 hover:bg-white/10'
                }`}
              >
                부산 선택
              </button>
            </div>

            <button
              type="button"
              onClick={() => void handleVote()}
              disabled={isSubmittingVote || (!isAuthenticated && guestHasVoted)}
              className="mt-5 inline-flex h-14 w-full items-center justify-center rounded-[22px] border border-[#ff9f0a66] bg-[#ff6b00] text-[17px] font-bold text-white shadow-[0_8px_24px_rgba(255,107,0,0.45)] transition active:scale-[0.99] hover:bg-[#ff7c1f] disabled:cursor-not-allowed disabled:opacity-65"
            >
              {isSubmittingVote
                ? '처리 중...'
                : !isAuthenticated && guestHasVoted
                  ? '이미 투표 완료'
                  : `${selectedOption === POPULAR_OPTION_A ? '서울' : '부산'}에 투표하기`}
            </button>

            {voteMessage ? <p className="mt-3 text-center text-xs text-white/75">{voteMessage}</p> : null}
          </motion.div>
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
                      <span>서울 {aPercent}%</span>
                      <span>부산 {bPercent}%</span>
                    </div>
                    <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full bg-[#ff6b00]" style={{ width: `${aPercent}%` }} />
                      <div className="h-full bg-[#2f74ff]" style={{ width: `${bPercent}%` }} />
                    </div>
                    <p className="mt-2 text-[12px] text-white/65">
                      참여 {total.toLocaleString()}표 · 서울 {countA.toLocaleString()} · 부산{' '}
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
        <div className="pointer-events-auto mx-auto w-full max-w-[430px] px-4 pb-2">
          <button
            type="button"
            onClick={handleOpenTopicSheet}
            className="inline-flex h-12 w-full items-center justify-center rounded-[18px] border border-[#ff9f0a77] bg-[#ff6b00] text-[15px] font-bold text-white shadow-[0_10px_24px_rgba(255,107,0,0.42)] transition active:scale-[0.995] hover:bg-[#ff7c1f]"
          >
            다른 주제 투표하기
          </button>
        </div>

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
        </nav>
      </div>

      {isTopicSheetOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/55 p-4 sm:items-end"
          onClick={() => setIsTopicSheetOpen(false)}
        >
          <div
            className="w-full max-w-[430px] rounded-[28px] border border-white/12 bg-[rgba(22,22,26,0.97)] p-5 shadow-2xl backdrop-blur-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-[20px] font-semibold text-white">다른 주제 선택</h4>
                <p className="mt-1 text-xs text-white/60">
                  1개 이상 선택 · 최대 {TOPIC_SELECTION_LIMIT}개
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsTopicSheetOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-white/65 hover:bg-white/10 hover:text-white"
              >
                닫기
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
              <TagSelector<VoteTopic>
                availableTags={availableTopics}
                selectedTags={selectedTopicTags}
                onChange={handleTopicTagsChange}
                getValue={(topic) => topic.id}
                getLabel={(topic) => topic.title}
                heading="LIVE 주제"
                placeholder="주제를 선택하세요"
                inputPlaceholder="주제 검색"
                emptyMessage="검색 결과가 없습니다."
                className="mt-1"
              />
            )}

            <p className="mt-2 min-h-5 text-xs text-white/65">
              {topicsError ?? `선택됨 ${selectedTopicIds.length}개`}
            </p>

            <button
              type="button"
              onClick={handleTopicSelectionComplete}
              disabled={selectedTopicIds.length === 0}
              className="mt-2 inline-flex h-12 w-full items-center justify-center rounded-2xl border border-[#ff9f0a66] bg-[#ff6b00] text-[15px] font-bold text-white shadow-[0_8px_24px_rgba(255,107,0,0.35)] transition hover:bg-[#ff7c1f] disabled:cursor-not-allowed disabled:opacity-60"
            >
              선택 완료
            </button>
          </div>
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
