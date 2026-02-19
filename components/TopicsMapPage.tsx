'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  addPendingVoteTopic,
  getOrCreateGuestToken,
  readPendingProfile,
  readPendingVotes,
  writePendingProfile,
} from '@/lib/vote/client-storage';
import type { Gender, SchoolSearchItem, VoteProfileInput, VoteTopic } from '@/lib/vote/types';
import type { RegionVoteMap } from './KoreaAdminMap';
import { TagSelector } from '@/components/ui/tag-selector';

const KoreaAdminMap = dynamic(() => import('@/components/KoreaAdminMap'), { ssr: false });
const TOPICS_MAP_INITIAL_CENTER: [number, number] = [127.75, 36.18];
const TOPICS_MAP_COLORS = {
  a: 'rgba(255, 90, 0, 0.95)',
  b: 'rgba(30, 120, 255, 0.95)',
  tie: 'rgba(255, 193, 63, 0.95)',
  neutral: 'rgba(42, 34, 30, 0.18)',
} as const;
const GENDER_OPTIONS: Array<{ value: Gender; label: string }> = [
  { value: 'male', label: '남성' },
  { value: 'female', label: '여성' },
];

type TopicsMapPageProps = {
  initialTopicIds: string[];
};

type VoteSummary = {
  totalVotes: number;
  countA: number;
  countB: number;
  aPercent: number;
  bPercent: number;
  hasData: boolean;
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

function normalizeBinaryGender(value: Gender | null | undefined): Gender {
  return value === 'female' ? 'female' : 'male';
}

export default function TopicsMapPage({ initialTopicIds }: TopicsMapPageProps) {
  const prefersReducedMotion = useReducedMotion();
  const [topics, setTopics] = useState<VoteTopic[]>([]);
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
  const [birthYear, setBirthYear] = useState<number>(() => new Date().getFullYear() - 17);
  const [gender, setGender] = useState<Gender>('male');
  const [selectedSchool, setSelectedSchool] = useState<SchoolSearchItem | null>(null);
  const [guestToken, setGuestToken] = useState<string | null>(null);
  const [guestHasVoted, setGuestHasVoted] = useState(false);
  const [bottomDockHeight, setBottomDockHeight] = useState(152);
  const statsRequestRef = useRef(0);
  const topicStatsCacheRef = useRef<Record<string, { mapStats: RegionVoteMap; summary: VoteSummary }>>({});
  const bottomDockRef = useRef<HTMLDivElement | null>(null);

  const topicIdsKey = useMemo(() => initialTopicIds.join(','), [initialTopicIds]);
  const { isAuthenticated, isLoading, profile, signOut } = useAuth();
  const hasServerProfile = Boolean(profile?.birth_year && profile?.gender && profile?.school_id);
  const cardEase: [number, number, number, number] = [0.2, 0.65, 0.3, 0.9];
  const cardTransition = {
    duration: prefersReducedMotion ? 0.12 : 0.3,
    ease: cardEase,
  };
  const cardLayoutTransition = {
    layout: {
      duration: prefersReducedMotion ? 0.12 : 0.34,
      ease: cardEase,
    },
  };

  const activeTopic = useMemo(
    () => topics.find((topic) => topic.id === activeTopicId) ?? null,
    [activeTopicId, topics],
  );
  const optionA = activeTopic?.options.find((option) => option.position === 1) ?? null;
  const optionB = activeTopic?.options.find((option) => option.position === 2) ?? null;
  const selectedOptionLabel = activeTopic?.options.find((option) => option.key === selectedOptionKey)?.label ?? null;
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
    let cancelled = false;

    const run = async () => {
      if (!topicIdsKey) {
        setIsTopicsLoading(false);
        setTopics([]);
        setActiveTopicId(null);
        return;
      }

      setIsTopicsLoading(true);
      setTopicsError(null);
      try {
        const response = await fetch(`/api/votes/topics?status=LIVE&ids=${encodeURIComponent(topicIdsKey)}`, {
          cache: 'no-store',
        });
        const json = (await response.json()) as { topics?: VoteTopic[]; error?: string };
        if (!response.ok) {
          if (!cancelled) {
            setTopicsError(json.error ?? '주제 목록을 불러오지 못했습니다.');
            setTopics([]);
            setActiveTopicId(null);
          }
          return;
        }

        const nextTopics = json.topics ?? [];
        if (cancelled) {
          return;
        }

        setTopics(nextTopics);
        setActiveTopicId(nextTopics[0]?.id ?? null);
      } catch {
        if (!cancelled) {
          setTopicsError('주제 목록을 불러오지 못했습니다.');
          setTopics([]);
          setActiveTopicId(null);
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
  }, [topicIdsKey]);

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
    const token = getOrCreateGuestToken();
    setGuestToken(token);

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
    const node = bottomDockRef.current;
    if (!node || typeof ResizeObserver === 'undefined') {
      return;
    }

    const updateHeight = () => {
      const next = Math.max(152, Math.ceil(node.getBoundingClientRect().height));
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
      if (!activeTopicId || !selectedOptionKey || !optionA || !optionB) {
        return;
      }

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
            topicId: activeTopicId,
            optionKey: selectedOptionKey,
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
          addPendingVoteTopic(activeTopicId);
          setGuestHasVoted(true);
        }

        const optimisticSidoCode = profilePayload?.school.sidoCode ?? profile?.sido_code ?? null;
        const optimisticSigunguCode = profilePayload?.school.sigunguCode ?? profile?.sigungu_code ?? null;

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
        await loadRegionStats(activeTopicId);
      } catch {
        setVoteMessage('투표 처리 중 오류가 발생했습니다.');
      } finally {
        setIsSubmittingVote(false);
      }
    },
    [
      activeTopicId,
      guestToken,
      isAuthenticated,
      loadRegionStats,
      optionA,
      optionB,
      profile?.sido_code,
      profile?.sigungu_code,
      selectedOptionKey,
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

  return (
    <main className="relative h-screen w-full overflow-hidden bg-black text-white [font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text','SF_Pro_Display','Segoe_UI',sans-serif]">
      <div className="absolute inset-0">
        <KoreaAdminMap
          key={`${activeTopicId ?? 'topics-map-empty'}-${mapStatsSignature}`}
          statsByCode={mapStats}
          height="100%"
          initialCenter={TOPICS_MAP_INITIAL_CENTER}
          initialZoom={6}
          bottomDockHeightPx={bottomDockHeight}
          toggleClearancePx={22}
          theme="dark"
          showNavigationControl={false}
          showTooltip={false}
          showRegionLevelToggle
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

      <div className="pointer-events-none relative z-20 mx-auto flex h-full w-full max-w-[430px] flex-col px-4 pb-[calc(8.2rem+env(safe-area-inset-bottom))] pt-[calc(0.7rem+env(safe-area-inset-top))]">
        <header className="pointer-events-auto rounded-[24px] border border-white/14 bg-[rgba(26,26,30,0.58)] px-4 pb-4 pt-3 shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur-2xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#ff9f0a]">Topics Map</p>
              <p className="mt-1 text-[14px] font-semibold text-white/92">선택 주제 투표 지도</p>
            </div>
            {isLoading ? (
              <span className="inline-flex h-11 items-center rounded-full border border-white/20 bg-white/10 px-4 text-[12px] font-semibold text-white/75">
                확인중
              </span>
            ) : isAuthenticated ? (
              <button
                type="button"
                onClick={() => void signOut()}
                className="inline-flex h-11 items-center rounded-full border border-white/20 bg-white/10 px-4 text-[12px] font-semibold text-white/85 hover:bg-white/15"
              >
                로그아웃
              </button>
            ) : (
              <Link
                href="/auth"
                className="inline-flex h-11 items-center rounded-full border border-white/20 bg-white/10 px-4 text-[12px] font-semibold text-white transition hover:bg-white/20"
              >
                로그인
              </Link>
            )}
          </div>
          <p className="mt-2 text-[12px] text-white/62">
            {activeTopic ? `현재 주제: ${activeTopic.title}` : '주제를 불러오는 중입니다.'}
          </p>
        </header>

        {isTopicsLoading ? (
          <section className="pointer-events-auto mt-3 rounded-[22px] border border-white/12 bg-[rgba(20,20,24,0.62)] px-4 py-4 text-sm text-white/75 shadow-[0_8px_24px_rgba(0,0,0,0.3)] backdrop-blur-2xl">
            주제 목록 불러오는 중...
          </section>
        ) : topics.length === 0 ? (
          <section className="pointer-events-auto mt-3 rounded-[22px] border border-white/12 bg-[rgba(20,20,24,0.62)] px-4 py-4 shadow-[0_8px_24px_rgba(0,0,0,0.3)] backdrop-blur-2xl">
            <h2 className="text-lg font-semibold text-white">선택된 주제가 없습니다.</h2>
            <p className="mt-2 text-sm text-white/70">
              {topicsError ?? '유효한 LIVE 주제를 찾지 못했습니다. 홈에서 주제를 다시 선택해 주세요.'}
            </p>
            <Link
              href="/"
              className="mt-4 inline-flex h-11 items-center justify-center rounded-2xl border border-[#ff9f0a66] bg-[#ff6b00] px-4 text-sm font-bold text-white hover:bg-[#ff7c1f]"
            >
              홈에서 다시 선택하기
            </Link>
          </section>
        ) : (
          <>
            <section className="pointer-events-auto mt-3 rounded-[22px] border border-white/12 bg-[rgba(20,20,24,0.62)] p-3 shadow-[0_8px_24px_rgba(0,0,0,0.3)] backdrop-blur-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">선택 주제 태그</p>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {topics.map((topic) => {
                  const active = topic.id === activeTopicId;
                  return (
                    <button
                      key={topic.id}
                      type="button"
                      onClick={() => setActiveTopicId(topic.id)}
                      className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                        active
                          ? 'border-[#ff9f0a88] bg-[#ff6b0033] text-[#ffcc99]'
                          : 'border-white/15 bg-white/8 text-white/80 hover:bg-white/12'
                      }`}
                    >
                      {topic.title}
                    </button>
                  );
                })}
              </div>
              {topicsError ? <p className="mt-2 text-xs text-[#ffb4b4]">{topicsError}</p> : null}
            </section>

            <div className="flex-1" />

            <motion.section
              layout
              transition={cardLayoutTransition}
              className={`pointer-events-auto mt-3 shrink-0 overflow-hidden border bg-[rgba(26,26,30,0.62)] shadow-[0_8px_26px_rgba(0,0,0,0.35)] backdrop-blur-2xl ${
                isVoteCardCollapsed
                  ? 'rounded-[22px] border-white/12 p-3'
                  : 'rounded-[28px] border-white/14 p-4'
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
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#ff9f0a]">주제 지도</p>
                    <p className="truncate text-[14px] font-semibold text-white/92">{activeTopic?.title ?? '주제 없음'}</p>
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
                        <div className="absolute inset-y-0 left-0 rounded-r-full bg-[#ff6b00]" style={{ width: `${summary.aPercent}%` }} />
                        <div className="absolute inset-y-0 right-0 rounded-l-full bg-[#2f74ff]" style={{ width: `${summary.bPercent}%` }} />
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
                  <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-white">주제별 즉시 투표</h2>
                  <button
                    type="button"
                    onClick={() => setIsVoteCardCollapsed(true)}
                    className="inline-flex h-11 items-center rounded-lg border border-white/20 bg-white/10 px-3 text-[12px] font-semibold text-white/80 hover:bg-white/15"
                  >
                    최소화
                  </button>
                </div>

                <h3 className="text-[20px] font-semibold leading-tight text-white">{activeTopic?.title ?? '주제 없음'}</h3>
                <p className="mt-1.5 text-[15px] text-white/62">
                  {isStatsLoading ? '집계 불러오는 중...' : `총 ${summary.totalVotes.toLocaleString()}표 참여`}
                </p>

                <div className="mt-4 space-y-3 text-[15px]">
                  <div className="flex items-center justify-between text-white/88">
                    <span className="font-semibold">{optionA?.label ?? '선택지 A'}</span>
                    <span className="font-semibold">{optionB?.label ?? '선택지 B'}</span>
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
                    <span className="font-semibold text-[#ffb784]">{summary.hasData ? `${summary.aPercent}%` : '-'}</span>
                    <span className="font-semibold text-[#9cbcff]">{summary.hasData ? `${summary.bPercent}%` : '-'}</span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => optionA && setSelectedOptionKey(optionA.key)}
                    disabled={!optionA}
                    className={`inline-flex h-11 items-center justify-center rounded-xl border text-[14px] font-semibold transition ${
                      selectedOptionKey === optionA?.key
                        ? 'border-[#ff9f0a88] bg-[#ff6b0030] text-[#ffbf88]'
                        : 'border-white/15 bg-white/5 text-white/80 hover:bg-white/10'
                    }`}
                  >
                    {optionA?.label ?? '선택지 A'}
                  </button>
                  <button
                    type="button"
                    onClick={() => optionB && setSelectedOptionKey(optionB.key)}
                    disabled={!optionB}
                    className={`inline-flex h-11 items-center justify-center rounded-xl border text-[14px] font-semibold transition ${
                      selectedOptionKey === optionB?.key
                        ? 'border-[#7fb0ff88] bg-[#2f74ff30] text-[#b8d2ff]'
                        : 'border-white/15 bg-white/5 text-white/80 hover:bg-white/10'
                    }`}
                  >
                    {optionB?.label ?? '선택지 B'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => void handleVote()}
                  disabled={isSubmittingVote || !selectedOptionKey || (!isAuthenticated && guestHasVoted)}
                  className="mt-5 inline-flex h-14 w-full items-center justify-center rounded-[22px] border border-[#ff9f0a66] bg-[#ff6b00] text-[17px] font-bold text-white shadow-[0_8px_24px_rgba(255,107,0,0.45)] transition active:scale-[0.99] hover:bg-[#ff7c1f] disabled:cursor-not-allowed disabled:opacity-65"
                >
                  {isSubmittingVote
                    ? '처리 중...'
                    : !isAuthenticated && guestHasVoted
                      ? '이미 투표 완료'
                      : `${selectedOptionLabel ?? '선택한 항목'}에 투표하기`}
                </button>

                {voteMessage ? <p className="mt-3 text-center text-xs text-white/75">{voteMessage}</p> : null}
              </motion.div>
            </motion.section>

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

            <div className="h-3" />
          </>
        )}
      </div>

      <div ref={bottomDockRef} className="pointer-events-none fixed inset-x-0 bottom-0 z-30">
        <div className="pointer-events-auto mx-auto w-full max-w-[430px] px-4 pb-[calc(0.8rem+env(safe-area-inset-bottom))]">
          <Link
            href="/"
            className="inline-flex h-16 w-full items-center justify-center rounded-full border border-[#ff9f0a66] bg-[#ff6b00] text-[17px] font-bold text-white shadow-[0_8px_28px_rgba(255,107,0,0.5)] transition active:scale-[0.995] hover:bg-[#ff7c1f] [@media(max-height:700px)]:h-14"
          >
            주제 다시 고르기
          </Link>
        </div>
      </div>

      {showProfileModal ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/55 p-4 sm:items-center">
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
