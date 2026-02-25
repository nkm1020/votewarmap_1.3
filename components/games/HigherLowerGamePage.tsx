'use client';

import { type TouchEvent, type WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { clearPendingGameScore, readPendingGameScore, writePendingGameScore } from '@/lib/vote/client-storage';

type Choice = 'A' | 'B' | 'TIE';
type LeaderboardPeriod = 'daily' | 'weekly' | 'all';

type RegionBattleQuestion = {
  id: string;
  topicId: string;
  topicTitle: string;
  regionLevel: 'sigungu' | 'sido';
  regionCode: string;
  regionName: string;
  totalVotes: number;
  optionA: {
    key: string;
    label: string;
    percent: number;
  };
  optionB: {
    key: string;
    label: string;
    percent: number;
  };
  winner: Choice;
};

type RegionBattlePoolResponse = {
  items?: RegionBattleQuestion[];
  meta?: {
    topicCount: number;
    itemCount: number;
  };
  error?: string;
};

type RegionBattleLeaderboardItem = {
  rank: number;
  displayName: string;
  score: number;
  achievedAt: string;
};

type RegionBattleLeaderboardResponse = {
  items?: RegionBattleLeaderboardItem[];
  meta?: {
    period: LeaderboardPeriod;
    limit: number;
    itemCount: number;
    timezone: 'Asia/Seoul';
  };
  error?: string;
};

type RegionBattleScoreSubmitRequest = {
  runId: string;
  score: number;
};

type RegionBattleScoreSubmitResponse = {
  saved: true;
  duplicated?: boolean;
  bestScoreAllTime: number;
  error?: string;
};

type FrameFeedbackFlash = {
  key: number;
  tone: 'correct' | 'wrong' | 'tie_bonus';
};

const BEST_SCORE_STORAGE_KEY = 'region-battle-best-score';
const AUTO_NEXT_DELAY_MS = 2000;
const REVEAL_FILL_DURATION_MS = 700;
const SHAKE_DURATION_S = 0.35;
const LEADERBOARD_LIMIT = 10;
const MAX_SERVER_SCORE = 9999;
const DOCK_SCROLL_TOUCH_THRESHOLD_PX = 6;
const TIE_BONUS_POINTS = 10;

const LEADERBOARD_TABS: ReadonlyArray<{ key: LeaderboardPeriod; label: string }> = [
  { key: 'daily', label: '일간' },
  { key: 'weekly', label: '주간' },
  { key: 'all', label: '전체' },
];

function chooseRandomQuestion(
  pool: RegionBattleQuestion[],
  previousQuestionId: string | null,
): RegionBattleQuestion | null {
  if (pool.length === 0) {
    return null;
  }
  if (pool.length === 1) {
    return pool[0] ?? null;
  }

  for (let i = 0; i < 16; i += 1) {
    const picked = pool[Math.floor(Math.random() * pool.length)];
    if (!picked) {
      continue;
    }
    if (picked.id !== previousQuestionId) {
      return picked;
    }
  }

  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

function createRunId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16;
    const value = char === 'x' ? random : (random % 4) + 8;
    return Math.floor(value).toString(16);
  });
}

function normalizeScoreForServer(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.min(MAX_SERVER_SCORE, Math.max(0, Math.trunc(score)));
}

export function HigherLowerGamePage() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();

  const [items, setItems] = useState<RegionBattleQuestion[]>([]);
  const [usedQuestionIds, setUsedQuestionIds] = useState<string[]>([]);
  const [question, setQuestion] = useState<RegionBattleQuestion | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedChoice, setSelectedChoice] = useState<Choice | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);

  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [isGameOver, setIsGameOver] = useState(false);
  const [bestScore, setBestScore] = useState(0);
  const [currentRunId, setCurrentRunId] = useState<string>(() => createRunId());
  const [activeTab, setActiveTab] = useState<'home' | 'map' | 'game' | 'me'>('game');

  const [leaderboardPeriod, setLeaderboardPeriod] = useState<LeaderboardPeriod>('all');
  const [leaderboardItems, setLeaderboardItems] = useState<RegionBattleLeaderboardItem[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [isLeaderboardExpanded, setIsLeaderboardExpanded] = useState(false);
  const [bottomDockHeight, setBottomDockHeight] = useState(0);

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [frameFeedbackFlash, setFrameFeedbackFlash] = useState<FrameFeedbackFlash | null>(null);

  const savedRunIdsRef = useRef<Set<string>>(new Set());
  const bottomDockRef = useRef<HTMLDivElement | null>(null);
  const dockTouchStartYRef = useRef<number | null>(null);
  const dockTouchLastYRef = useRef<number | null>(null);
  const dockTouchMovedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const stored = Number(window.localStorage.getItem(BEST_SCORE_STORAGE_KEY));
    if (Number.isFinite(stored) && stored >= 0) {
      setBestScore(Math.trunc(stored));
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(BEST_SCORE_STORAGE_KEY, String(bestScore));
  }, [bestScore]);

  useEffect(() => {
    const dockNode = bottomDockRef.current;
    if (!dockNode) {
      return;
    }

    const updateHeight = () => {
      const nextHeight = Math.ceil(dockNode.getBoundingClientRect().height);
      setBottomDockHeight(nextHeight > 0 ? nextHeight : 0);
    };

    updateHeight();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(dockNode);
    return () => observer.disconnect();
  }, []);

  const loadLeaderboard = useCallback(async (period: LeaderboardPeriod) => {
    setLeaderboardLoading(true);
    setLeaderboardError(null);

    try {
      const response = await fetch(
        `/api/game/region-battle-leaderboard?period=${period}&limit=${LEADERBOARD_LIMIT}`,
        { cache: 'no-store' },
      );
      const json = (await response.json()) as RegionBattleLeaderboardResponse;
      if (!response.ok) {
        setLeaderboardItems([]);
        setLeaderboardError(json.error ?? '리더보드를 불러오지 못했습니다.');
        return;
      }

      const nextItems = Array.isArray(json.items) ? json.items : [];
      setLeaderboardItems(nextItems);
      setLeaderboardError(null);
    } catch {
      setLeaderboardItems([]);
      setLeaderboardError('리더보드를 불러오지 못했습니다.');
    } finally {
      setLeaderboardLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLeaderboard(leaderboardPeriod);
  }, [leaderboardPeriod, loadLeaderboard]);

  const drawNextQuestion = useCallback(
    (forceReset = false) => {
      if (items.length === 0) {
        setQuestion(null);
        setUsedQuestionIds([]);
        setSelectedChoice(null);
        setIsRevealed(false);
        setIsCorrect(null);
        return;
      }

      let baseUsed = forceReset ? [] : usedQuestionIds;
      let pool = items.filter((item) => !baseUsed.includes(item.id));

      if (pool.length === 0) {
        baseUsed = [];
        pool = items;
      }

      const picked = chooseRandomQuestion(pool, question?.id ?? null);
      if (!picked) {
        setQuestion(null);
        return;
      }

      setQuestion(picked);
      setUsedQuestionIds([...baseUsed, picked.id]);
      setSelectedChoice(null);
      setIsRevealed(false);
      setIsCorrect(null);
    },
    [items, question?.id, usedQuestionIds],
  );

  const loadPool = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/game/region-battle-pool?status=LIVE&minTotalVotes=1', {
        cache: 'no-store',
      });
      const json = (await response.json()) as RegionBattlePoolResponse;
      if (!response.ok) {
        setError(json.error ?? '게임 데이터를 불러오지 못했습니다.');
        setItems([]);
        setQuestion(null);
        return;
      }

      const nextItems = Array.isArray(json.items) ? json.items : [];
      setItems(nextItems);
      setUsedQuestionIds([]);
      setQuestion(null);

      if (nextItems.length === 0) {
        return;
      }
    } catch {
      setError('게임 데이터를 불러오지 못했습니다.');
      setItems([]);
      setQuestion(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPool();
  }, [loadPool]);

  useEffect(() => {
    if (items.length > 0 && !question) {
      drawNextQuestion(true);
    }
  }, [drawNextQuestion, items, question]);

  useEffect(() => {
    if (score > bestScore) {
      setBestScore(score);
    }
  }, [bestScore, score]);

  useEffect(() => {
    if (!isGameOver) {
      return;
    }
    setIsLeaderboardExpanded(true);
  }, [isGameOver]);

  const handleSelectLeaderboardPeriod = useCallback((period: LeaderboardPeriod) => {
    setLeaderboardPeriod(period);
    setIsLeaderboardExpanded(true);
  }, []);

  const submitScore = useCallback(async (payload: RegionBattleScoreSubmitRequest) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      throw new Error('로그인 세션을 불러올 수 없습니다.');
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token ?? null;
    if (!accessToken) {
      throw new Error('로그인이 필요합니다.');
    }

    const response = await fetch('/api/game/region-battle-score', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    const json = (await response.json()) as RegionBattleScoreSubmitResponse;
    if (!response.ok) {
      throw new Error(json.error ?? '점수를 저장하지 못했습니다.');
    }

    return json;
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const pending = readPendingGameScore();
    if (!pending) {
      return;
    }

    if (savedRunIdsRef.current.has(pending.runId)) {
      clearPendingGameScore();
      return;
    }

    let cancelled = false;

    const persistPendingScore = async () => {
      setSaveState('saving');
      try {
        const result = await submitScore({
          runId: pending.runId,
          score: normalizeScoreForServer(pending.score),
        });

        if (cancelled) {
          return;
        }

        savedRunIdsRef.current.add(pending.runId);
        clearPendingGameScore();
        setBestScore((prev) => Math.max(prev, result.bestScoreAllTime));
        setSaveState('saved');
        await loadLeaderboard(leaderboardPeriod);
      } catch {
        if (cancelled) {
          return;
        }
        setSaveState('error');
      }
    };

    void persistPendingScore();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, leaderboardPeriod, loadLeaderboard, submitScore]);

  useEffect(() => {
    if (!isGameOver || !isAuthenticated) {
      return;
    }

    if (savedRunIdsRef.current.has(currentRunId)) {
      return;
    }

    let cancelled = false;

    const persistCurrentScore = async () => {
      setSaveState('saving');
      try {
        const result = await submitScore({
          runId: currentRunId,
          score: normalizeScoreForServer(score),
        });

        if (cancelled) {
          return;
        }

        savedRunIdsRef.current.add(currentRunId);
        setBestScore((prev) => Math.max(prev, result.bestScoreAllTime));
        setSaveState('saved');
        await loadLeaderboard(leaderboardPeriod);
      } catch {
        if (cancelled) {
          return;
        }
        setSaveState('error');
      }
    };

    void persistCurrentScore();

    return () => {
      cancelled = true;
    };
  }, [currentRunId, isAuthenticated, isGameOver, leaderboardPeriod, loadLeaderboard, score, submitScore]);

  const handlePick = useCallback(
    (choice: Choice) => {
      if (!question || isRevealed || isGameOver) {
        return;
      }

      const isExactTie = question.optionA.percent === 50 && question.optionB.percent === 50;
      const nextCorrect = choice === 'TIE' ? isExactTie : choice === question.winner;
      const isTieBonusHit = choice === 'TIE' && nextCorrect;
      setSelectedChoice(choice);
      setIsCorrect(nextCorrect);
      setIsRevealed(true);
      setFrameFeedbackFlash((prev) => ({
        key: (prev?.key ?? 0) + 1,
        tone: isTieBonusHit ? 'tie_bonus' : nextCorrect ? 'correct' : 'wrong',
      }));

      if (nextCorrect) {
        setScore((prev) => prev + (isTieBonusHit ? TIE_BONUS_POINTS : 1));
        return;
      }

      setLives((prev) => {
        const nextLives = Math.max(0, prev - 1);
        if (nextLives <= 0) {
          setIsGameOver(true);
        }
        return nextLives;
      });
    },
    [isGameOver, isRevealed, question],
  );

  const handleRestart = useCallback(() => {
    setScore(0);
    setLives(3);
    setIsGameOver(false);
    setSaveState('idle');
    setShareNotice(null);
    setFrameFeedbackFlash(null);
    setIsLeaderboardExpanded(false);
    setCurrentRunId(createRunId());
    drawNextQuestion(true);
  }, [drawNextQuestion]);

  useEffect(() => {
    if (!isRevealed || isGameOver) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      drawNextQuestion();
    }, AUTO_NEXT_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [drawNextQuestion, isGameOver, isRevealed, question?.id]);

  const handleShareResult = useCallback(async () => {
    if (typeof window === 'undefined') {
      return;
    }

    const shareText = `VoteWarMap 지역 배틀 게임에서 ${score}점! 너도 도전해봐`;
    const shareUrl = `${window.location.origin}/game`;

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Vote War Map · 지역 배틀 게임',
          text: shareText,
          url: shareUrl,
        });
        setShareNotice('공유창을 열었어요.');
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
      }
    }

    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        setShareNotice('링크를 복사했어요.');
        return;
      } catch {
        // clipboard fallback below
      }
    }

    setShareNotice('공유를 지원하지 않는 환경입니다.');
  }, [score]);

  const handleLoginAndSave = useCallback(() => {
    if (!isGameOver) {
      return;
    }

    writePendingGameScore({
      runId: currentRunId,
      score: normalizeScoreForServer(score),
      createdAt: new Date().toISOString(),
    });
    router.push('/auth?next=%2Fgame&intent=save-score');
  }, [currentRunId, isGameOver, router, score]);

  const handleBottomTabClick = useCallback(
    (tab: 'home' | 'map' | 'game' | 'me') => {
      if (tab === 'home') {
        router.push('/');
        return;
      }

      if (tab === 'map') {
        router.push('/topics-map?openTopicEditor=1');
        return;
      }

      if (tab === 'game') {
        setActiveTab('game');
        return;
      }

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
    },
    [router],
  );
  const isBottomDockDisabled = isGameOver;

  const handleBottomDockWheel = useCallback((event: WheelEvent<HTMLElement>) => {
    if (isBottomDockDisabled || event.deltaY === 0) {
      return;
    }
    event.preventDefault();
    window.scrollBy({ top: event.deltaY, behavior: 'auto' });
  }, [isBottomDockDisabled]);

  const resetBottomDockTouchState = useCallback(() => {
    dockTouchStartYRef.current = null;
    dockTouchLastYRef.current = null;
    dockTouchMovedRef.current = false;
  }, []);

  const handleBottomDockTouchStart = useCallback(
    (event: TouchEvent<HTMLElement>) => {
      if (isBottomDockDisabled) {
        return;
      }
      const y = event.touches[0]?.clientY;
      if (typeof y !== 'number') {
        return;
      }
      dockTouchStartYRef.current = y;
      dockTouchLastYRef.current = y;
      dockTouchMovedRef.current = false;
    },
    [isBottomDockDisabled],
  );

  const handleBottomDockTouchMove = useCallback(
    (event: TouchEvent<HTMLElement>) => {
      if (isBottomDockDisabled) {
        return;
      }
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
    },
    [isBottomDockDisabled],
  );

  const handleBottomDockTouchEnd = useCallback(() => {
    resetBottomDockTouchState();
  }, [resetBottomDockTouchState]);

  const winnerLabel = useMemo(() => {
    if (!question) {
      return '';
    }
    if (question.winner === 'TIE') {
      return '동률';
    }
    return question.winner === 'A' ? question.optionA.label : question.optionB.label;
  }, [question]);

  const saveStatusText = useMemo(() => {
    if (saveState === 'saving') {
      return '저장 중...';
    }
    if (saveState === 'saved') {
      return '저장 완료.';
    }
    if (saveState === 'error') {
      return '저장 실패. 다시 시도해 주세요.';
    }
    return '';
  }, [saveState]);

  const activePeriodLabel = useMemo(() => {
    return LEADERBOARD_TABS.find((tab) => tab.key === leaderboardPeriod)?.label ?? '전체';
  }, [leaderboardPeriod]);

  const leaderboardCollapsedSummary = useMemo(() => {
    if (leaderboardLoading) {
      return '리더보드 불러오는 중...';
    }
    if (leaderboardError) {
      return leaderboardError;
    }
    const topScore = leaderboardItems[0]?.score;
    if (typeof topScore === 'number') {
      return `${activePeriodLabel} · 1위 ${topScore}점`;
    }
    return `${activePeriodLabel} · 기록 없음`;
  }, [activePeriodLabel, leaderboardError, leaderboardItems, leaderboardLoading]);

  const isWinnerA = isRevealed && question?.winner === 'A';
  const isWinnerB = isRevealed && question?.winner === 'B';
  const isWinnerTie = isRevealed && question?.winner === 'TIE';
  const shouldShakeA = isRevealed && isCorrect === false && selectedChoice === 'A';
  const shouldShakeB = isRevealed && isCorrect === false && selectedChoice === 'B';
  const shouldShakeTie = isRevealed && isCorrect === false && selectedChoice === 'TIE';
  const isTieBonusRound =
    isRevealed && isCorrect && selectedChoice === 'TIE' && question?.optionA.percent === 50 && question?.optionB.percent === 50;
  const canPlay = items.length > 0;

  return (
    <div className="bg-[#070d16] text-white">
      {frameFeedbackFlash ? (
        <motion.div
          key={`frame-feedback-${frameFeedbackFlash.key}`}
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[120]"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0.75, 0] }}
          transition={{ duration: 0.58, ease: 'easeOut' }}
        >
          <motion.div
            className={`absolute inset-[2px] rounded-[16px] border-[3px] sm:inset-[4px] sm:rounded-[18px] sm:border-[5px] ${
              frameFeedbackFlash.tone === 'tie_bonus'
                ? 'border-[#ffd166]/95 shadow-[0_0_0_1px_rgba(255,209,102,0.55),0_0_38px_rgba(245,158,11,0.72)]'
                : frameFeedbackFlash.tone === 'correct'
                ? 'border-emerald-300/95 shadow-[0_0_0_1px_rgba(52,211,153,0.35),0_0_28px_rgba(16,185,129,0.56)]'
                : 'border-[#ffb4b4]/95 shadow-[0_0_0_1px_rgba(252,165,165,0.35),0_0_28px_rgba(239,68,68,0.56)]'
            }`}
            initial={{ scale: 0.996 }}
            animate={{ scale: [0.996, 1.004, 1] }}
            transition={{ duration: 0.58, ease: 'easeOut' }}
          />
          {frameFeedbackFlash.tone === 'tie_bonus' ? (
            <>
              <motion.div
                className="absolute left-1/2 top-1/2 h-[180px] w-[180px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#ffd166]/75"
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: [0.4, 1.16], opacity: [0, 0.92, 0] }}
                transition={{ duration: 0.62, ease: 'easeOut' }}
              />
              <motion.div
                className="absolute left-1/2 top-1/2 h-[260px] w-[260px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#fff0c2]/55"
                initial={{ scale: 0.35, opacity: 0 }}
                animate={{ scale: [0.35, 1.08], opacity: [0, 0.66, 0] }}
                transition={{ duration: 0.74, ease: 'easeOut' }}
              />
              <motion.div
                className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-[16px] border border-[#ffd166]/80 bg-[rgba(245,158,11,0.22)] px-4 py-2 text-center shadow-[0_10px_28px_rgba(245,158,11,0.42)] backdrop-blur-sm"
                initial={{ opacity: 0, y: 28, scale: 0.7, rotate: -8 }}
                animate={{ opacity: [0, 1, 1, 0], y: [28, -2, -18, -34], scale: [0.7, 1.08, 1, 0.9], rotate: [-8, 0, 0, 4] }}
                transition={{ duration: 0.84, ease: 'easeOut' }}
              >
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#fff4ce]">Perfect Tie</p>
                <p className="text-[30px] font-black leading-none text-[#ffd166]">+{TIE_BONUS_POINTS}</p>
              </motion.div>
            </>
          ) : null}
        </motion.div>
      ) : null}

      <AnimatePresence>
        {isGameOver ? (
          <motion.div
            key="game-over-modal"
            className="fixed inset-0 z-[160] flex items-center justify-center px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <motion.div
              aria-hidden
              className="absolute inset-0 bg-[rgba(4,8,14,0.72)] backdrop-blur-[3px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            />
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-labelledby="region-battle-game-over-title"
              className="relative z-10 w-full max-w-[352px] rounded-[24px] border border-white/15 bg-[rgba(13,20,33,0.95)] p-4 shadow-[0_20px_48px_rgba(0,0,0,0.5)] backdrop-blur-2xl"
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.97 }}
              transition={{ duration: 0.23, ease: 'easeOut' }}
            >
              <h2 id="region-battle-game-over-title" className="text-[18px] font-extrabold text-[#ffcbc8]">
                게임 종료
              </h2>
              <p className="mt-1 text-[12px] text-white/68">우리 지역 vs 전국 예측 라운드가 끝났어요.</p>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-[12px] border border-white/12 bg-white/[0.04] px-3 py-2">
                  <p className="text-[11px] text-white/62">최종 점수</p>
                  <p className="mt-0.5 text-[17px] font-bold text-white">{score}점</p>
                </div>
                <div className="rounded-[12px] border border-white/12 bg-white/[0.04] px-3 py-2">
                  <p className="text-[11px] text-white/62">최고 점수</p>
                  <p className="mt-0.5 text-[17px] font-bold text-[#8fb8ff]">{bestScore}점</p>
                </div>
              </div>

              <div
                className={`mt-3 rounded-[14px] border px-3 py-2 ${
                  isAuthenticated ? 'border-white/12 bg-white/[0.04]' : 'border-[#ff9f0a66] bg-[#ff9f0a14]'
                }`}
              >
                <p className="text-[11px] font-semibold text-white/62">{isAuthenticated ? '리더보드 저장 상태' : '기록 저장 안내'}</p>
                {isAuthenticated ? (
                  <p
                    className={`mt-1 text-[12px] ${
                      saveState === 'error' ? 'text-[#ffb4b4]' : saveState === 'saved' ? 'text-emerald-300' : 'text-white/74'
                    }`}
                  >
                    {saveStatusText || '저장 준비 중...'}
                  </p>
                ) : (
                  <p className="mt-1 text-[12px] text-white/80">로그인 후 점수를 리더보드에 저장할 수 있어요.</p>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void handleShareResult()}
                  className="inline-flex h-11 items-center justify-center rounded-[12px] border border-white/18 bg-white/10 px-3 text-[13px] font-semibold text-white transition hover:bg-white/14"
                >
                  공유하기
                </button>
                <button
                  type="button"
                  onClick={handleRestart}
                  className="inline-flex h-11 items-center justify-center rounded-[12px] border border-white/18 bg-white/10 px-3 text-[13px] font-semibold text-white transition hover:bg-white/14"
                >
                  다시 시작
                </button>
              </div>

              {!isAuthenticated ? (
                <button
                  type="button"
                  onClick={handleLoginAndSave}
                  className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-[12px] border border-[#ff9f0a66] bg-[#ff6b00] px-3 text-[13px] font-semibold text-white transition hover:bg-[#ff7b1d]"
                >
                  로그인하고 저장
                </button>
              ) : null}

              {shareNotice ? <p className="mt-2 text-[12px] text-white/72">{shareNotice}</p> : null}
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <main className="relative h-screen w-full overflow-hidden">
        <div
          className="mx-auto flex h-full w-full max-w-[430px] flex-col overflow-y-auto px-4 pb-4 pt-[calc(0.55rem+env(safe-area-inset-top))]"
          style={{ paddingBottom: `${Math.max(bottomDockHeight + 12, 120)}px` }}
        >
        <motion.section
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut', delay: 0.04 }}
          className="mt-2 rounded-[20px] border border-white/12 bg-[rgba(16,21,33,0.72)] p-3 shadow-[0_8px_22px_rgba(0,0,0,0.22)] backdrop-blur-2xl"
        >
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-[12px] border border-white/12 bg-white/[0.04] px-3 py-2">
              <p className="text-[11px] text-white/60">점수</p>
              <p className="text-[18px] font-bold text-white">{score}</p>
            </div>
            <div className="rounded-[12px] border border-white/12 bg-white/[0.04] px-3 py-2">
              <p className="text-[11px] text-white/60">목숨</p>
              <p className="text-[18px] font-bold text-[#ff9f0a]">{'❤'.repeat(lives) || '0'}</p>
            </div>
            <div className="rounded-[12px] border border-white/12 bg-white/[0.04] px-3 py-2">
              <p className="text-[11px] text-white/60">최고</p>
              <p className="text-[18px] font-bold text-[#8fb8ff]">{bestScore}</p>
            </div>
          </div>

        </motion.section>

        <section className="mt-2 rounded-[22px] border border-white/12 bg-[rgba(16,21,33,0.74)] p-3 shadow-[0_8px_24px_rgba(0,0,0,0.26)] backdrop-blur-2xl">
          {isLoading ? (
            <p className="text-[12px] text-white/74">게임 데이터를 불러오는 중...</p>
          ) : error ? (
            <div className="space-y-3">
              <p className="text-[12px] text-[#ffb4b4]">{error}</p>
              <button
                type="button"
                onClick={() => void loadPool()}
                className="inline-flex h-11 items-center rounded-[12px] border border-white/15 bg-white/8 px-4 text-[13px] font-semibold text-white/90 transition hover:bg-white/12"
              >
                다시 시도
              </button>
            </div>
          ) : !canPlay || !question ? (
            <p className="text-[12px] text-white/74">플레이 가능한 데이터가 부족합니다.</p>
          ) : (
            <div className="space-y-3">
              <motion.div
                key={question.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="rounded-[20px] border border-white/12 bg-white/[0.04] px-3 py-3"
              >
                <p className="text-[12px] font-semibold text-white/72">현재 문제</p>
                <div className="mt-2 rounded-[14px] border border-white/10 bg-white/[0.02] px-3 py-2">
                  <p className="text-[11px] font-semibold text-white/62">지역</p>
                  <p className="mt-0.5 text-[15px] font-bold text-white">{question.regionName}</p>
                </div>

                <div className="mt-2 rounded-[14px] border border-white/10 bg-white/[0.02] px-3 py-2">
                  <p className="text-[11px] font-semibold text-white/62">주제</p>
                  <p className="mt-0.5 line-clamp-2 break-keep text-[15px] font-bold text-white">{question.topicTitle}</p>
                </div>
              </motion.div>

              <div className="relative py-1">
                <div className="grid grid-cols-2 gap-3">
                  <motion.button
                    type="button"
                    onClick={() => handlePick('A')}
                    disabled={isRevealed || isGameOver}
                    animate={shouldShakeA ? { x: [0, -7, 6, -4, 2, 0] } : { x: 0 }}
                    transition={shouldShakeA ? { duration: SHAKE_DURATION_S, ease: 'easeInOut' } : { duration: 0.15 }}
                    className={`group relative min-h-[176px] overflow-hidden rounded-[26px] border px-3 py-3 text-center shadow-[0_12px_26px_rgba(0,0,0,0.26)] transition ${
                      isRevealed
                        ? selectedChoice === 'A'
                          ? isCorrect
                            ? 'border-emerald-300/85 bg-[linear-gradient(138deg,rgba(255,107,0,0.92),rgba(255,159,10,0.85))] ring-2 ring-emerald-300'
                            : 'border-red-300/85 bg-[linear-gradient(138deg,rgba(255,107,0,0.92),rgba(255,159,10,0.85))] ring-2 ring-red-300'
                          : question.winner === 'A'
                            ? 'border-emerald-300/85 bg-[linear-gradient(138deg,rgba(255,107,0,0.92),rgba(255,159,10,0.85))] ring-2 ring-emerald-300'
                            : 'border-white/14 bg-[linear-gradient(138deg,rgba(255,107,0,0.82),rgba(255,159,10,0.72))]'
                        : 'border-[#ff9f0a66] bg-[linear-gradient(138deg,rgba(255,107,0,0.9),rgba(255,159,10,0.8))] hover:brightness-110'
                    }`}
                  >
                    <div
                      className={`pointer-events-none absolute inset-0 z-10 bg-white/28 transition-transform ease-out ${
                        isWinnerA ? 'origin-left scale-x-100' : 'origin-left scale-x-0'
                      }`}
                      style={{ transitionDuration: `${REVEAL_FILL_DURATION_MS}ms` }}
                    />
                    <div className="pointer-events-none absolute inset-0 z-20 bg-[radial-gradient(120%_85%_at_10%_0%,rgba(255,255,255,0.24),transparent_52%)]" />
                    <div className="relative z-30 flex h-full items-center justify-center pl-2 pr-[44px]">
                      <p className="line-clamp-3 break-keep text-[clamp(19px,4.6vw,34px)] font-extrabold leading-[1.24] text-white drop-shadow-[0_2px_7px_rgba(0,0,0,0.26)]">
                        {question.optionA.label}
                      </p>
                    </div>
                    {isRevealed ? (
                      <p className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-full border border-white/25 bg-[rgba(12,18,28,0.22)] px-2 py-0.5 text-[12px] font-bold text-white/95 backdrop-blur-sm">
                        {question.optionA.percent}%
                      </p>
                    ) : null}
                  </motion.button>

                  <motion.button
                    type="button"
                    onClick={() => handlePick('B')}
                    disabled={isRevealed || isGameOver}
                    animate={shouldShakeB ? { x: [0, -7, 6, -4, 2, 0] } : { x: 0 }}
                    transition={shouldShakeB ? { duration: SHAKE_DURATION_S, ease: 'easeInOut' } : { duration: 0.15 }}
                    className={`group relative min-h-[176px] overflow-hidden rounded-[26px] border px-3 py-3 text-center shadow-[0_12px_26px_rgba(0,0,0,0.26)] transition ${
                      isRevealed
                        ? selectedChoice === 'B'
                          ? isCorrect
                            ? 'border-emerald-300/85 bg-[linear-gradient(138deg,rgba(30,120,255,0.92),rgba(111,104,255,0.82))] ring-2 ring-emerald-300'
                            : 'border-red-300/85 bg-[linear-gradient(138deg,rgba(30,120,255,0.92),rgba(111,104,255,0.82))] ring-2 ring-red-300'
                          : question.winner === 'B'
                            ? 'border-emerald-300/85 bg-[linear-gradient(138deg,rgba(30,120,255,0.92),rgba(111,104,255,0.82))] ring-2 ring-emerald-300'
                            : 'border-white/14 bg-[linear-gradient(138deg,rgba(30,120,255,0.82),rgba(111,104,255,0.72))]'
                        : 'border-[#78a8ff66] bg-[linear-gradient(138deg,rgba(30,120,255,0.9),rgba(111,104,255,0.8))] hover:brightness-110'
                    }`}
                  >
                    <div
                      className={`pointer-events-none absolute inset-0 z-10 bg-white/28 transition-transform ease-out ${
                        isWinnerB ? 'origin-right scale-x-100' : 'origin-right scale-x-0'
                      }`}
                      style={{ transitionDuration: `${REVEAL_FILL_DURATION_MS}ms` }}
                    />
                    <div className="pointer-events-none absolute inset-0 z-20 bg-[radial-gradient(120%_85%_at_10%_0%,rgba(255,255,255,0.2),transparent_52%)]" />
                    <div className="relative z-30 flex h-full items-center justify-center pl-[44px] pr-2">
                      <p className="line-clamp-3 break-keep text-[clamp(19px,4.6vw,34px)] font-extrabold leading-[1.24] text-white drop-shadow-[0_2px_7px_rgba(0,0,0,0.26)]">
                        {question.optionB.label}
                      </p>
                    </div>
                    {isRevealed ? (
                      <p className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-full border border-white/25 bg-[rgba(12,18,28,0.22)] px-2 py-0.5 text-[12px] font-bold text-white/95 backdrop-blur-sm">
                        {question.optionB.percent}%
                      </p>
                    ) : null}
                  </motion.button>
                </div>

                <motion.button
                  type="button"
                  onClick={() => handlePick('TIE')}
                  disabled={isRevealed || isGameOver}
                  animate={shouldShakeTie ? { x: [0, -7, 6, -4, 2, 0] } : { x: 0 }}
                  transition={shouldShakeTie ? { duration: SHAKE_DURATION_S, ease: 'easeInOut' } : { duration: 0.15 }}
                  className={`absolute left-1/2 top-1/2 z-20 inline-flex h-[110px] w-[110px] aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#070d16] p-[10px] transition ${
                    isRevealed
                      ? selectedChoice === 'TIE'
                        ? isCorrect
                          ? 'ring-4 ring-emerald-300'
                          : 'ring-4 ring-red-300'
                        : question.winner === 'TIE'
                          ? 'ring-4 ring-emerald-300'
                          : 'opacity-95'
                      : 'hover:scale-[1.03]'
                  }`}
                >
                  <span className="relative inline-flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-[#9d7cf2] text-[18px] font-extrabold leading-none text-white">
                    <span
                      className={`pointer-events-none absolute inset-0 z-10 bg-white/28 transition-transform ease-out ${
                        isWinnerTie ? 'origin-center scale-100' : 'origin-center scale-0'
                      }`}
                      style={{ transitionDuration: `${REVEAL_FILL_DURATION_MS}ms` }}
                    />
                    <span className="relative z-20">동률</span>
                  </span>
                </motion.button>
              </div>

              {isRevealed ? (
                <div className="rounded-[20px] border border-white/12 bg-white/[0.04] px-3 py-3">
                  <p
                    className={`text-[13px] font-semibold ${
                      isTieBonusRound ? 'text-[#ffd166]' : isCorrect ? 'text-emerald-300' : 'text-[#ffb4b4]'
                    }`}
                  >
                    {isTieBonusRound ? `동률 완벽 적중! +${TIE_BONUS_POINTS}점` : isCorrect ? '정답입니다!' : '오답입니다.'}
                  </p>
                  <p className="mt-1 text-[12px] text-white/74">
                    정답: <span className="font-semibold text-white">{winnerLabel}</span> · 비율 {question.optionA.percent}% :{' '}
                    {question.optionB.percent}%
                  </p>
                  {!isGameOver ? <p className="mt-2 text-[12px] text-white/62">잠시 후 다음 문제로 넘어갑니다.</p> : null}
                </div>
              ) : null}
            </div>
          )}
        </section>

        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut', delay: 0.08 }}
          className="mt-2 rounded-[20px] border border-white/12 bg-[rgba(16,21,33,0.72)] p-3 shadow-[0_8px_22px_rgba(0,0,0,0.22)] backdrop-blur-2xl"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[12px] font-semibold text-white/86">리더보드</p>
              <p className="text-[11px] text-white/60">{activePeriodLabel} 기준</p>
            </div>
            <button
              type="button"
              onClick={() => setIsLeaderboardExpanded((prev) => !prev)}
              aria-label={isLeaderboardExpanded ? '리더보드 접기' : '리더보드 펼치기'}
              aria-expanded={isLeaderboardExpanded}
              className="inline-flex h-11 items-center rounded-[12px] border border-white/15 bg-white/8 px-3 text-[12px] font-semibold text-white/84 transition hover:bg-white/12"
            >
              {isLeaderboardExpanded ? '접기' : '펼치기'}
            </button>
          </div>

          <div className="mt-2 inline-flex rounded-[10px] border border-white/15 bg-white/[0.03] p-0.5">
            {LEADERBOARD_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                aria-label={`${tab.label} 리더보드`}
                onClick={() => handleSelectLeaderboardPeriod(tab.key)}
                className={`h-9 rounded-[8px] px-3 text-[12px] font-semibold transition ${
                  leaderboardPeriod === tab.key
                    ? 'bg-white/16 text-white'
                    : 'text-white/62 hover:bg-white/8 hover:text-white/86'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {!isLeaderboardExpanded ? (
            <p className="mt-2 text-[12px] text-white/76">{leaderboardCollapsedSummary}</p>
          ) : (
            <div className="mt-2">
              {leaderboardLoading ? (
                <p className="text-[12px] text-white/68">리더보드 불러오는 중...</p>
              ) : leaderboardError ? (
                <p className="text-[12px] text-[#ffb4b4]">{leaderboardError}</p>
              ) : leaderboardItems.length === 0 ? (
                <p className="text-[12px] text-white/68">아직 기록이 없습니다.</p>
              ) : (
                <ol className="space-y-1.5">
                  {leaderboardItems.map((item) => (
                    <li
                      key={`${item.rank}-${item.displayName}-${item.achievedAt}`}
                      className="flex items-center justify-between rounded-[10px] border border-white/10 bg-white/[0.03] px-2.5 py-1.5"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white/10 px-1.5 text-[11px] font-bold text-[#ffb13c]">
                          {item.rank}
                        </span>
                        <p className="truncate text-[12px] font-semibold text-white/88">{item.displayName}</p>
                      </div>
                      <p className="text-[12px] font-bold text-[#8fb8ff]">{item.score}점</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </motion.section>
        </div>

        <div ref={bottomDockRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-[130]">
          <div
            onWheel={handleBottomDockWheel}
            onTouchStart={handleBottomDockTouchStart}
            onTouchMove={handleBottomDockTouchMove}
            onTouchEnd={handleBottomDockTouchEnd}
            onTouchCancel={handleBottomDockTouchEnd}
            className={`pointer-events-auto ${isBottomDockDisabled ? 'pointer-events-none opacity-75' : ''}`}
            style={{ touchAction: 'pan-y' }}
          >
            <nav className="rounded-t-[24px] border-t border-white/14 bg-[rgba(12,18,28,0.82)] pb-2 pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
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
                    disabled={isBottomDockDisabled}
                    aria-disabled={isBottomDockDisabled}
                    onClick={() => handleBottomTabClick(tab.id)}
                    className={`inline-flex h-11 items-center justify-center rounded-2xl text-[14px] font-semibold transition ${
                      activeTab === tab.id ? 'bg-white/14 text-[#ff9f0a]' : 'text-white/62'
                    } ${isBottomDockDisabled ? 'cursor-not-allowed opacity-60' : 'hover:text-white'}`}
                    aria-label={`${tab.label} 탭`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </nav>

            <section className="border-t border-white/14 bg-[rgba(12,18,28,0.82)] pb-[calc(0.55rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
              <div className="mx-auto max-w-[430px] px-3">
                <section className="rounded-xl border border-white/14 bg-[rgba(255,255,255,0.06)] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-6 shrink-0 items-center rounded-md border border-[#ff9f0a66] bg-[#ff9f0a22] px-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#ffcc8a]">
                      광고
                    </span>
                    <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-white/80">스폰서 배너 영역입니다.</p>
                    <button
                      type="button"
                      disabled={isBottomDockDisabled}
                      aria-disabled={isBottomDockDisabled}
                      className={`inline-flex h-11 shrink-0 items-center rounded-lg border border-white/18 bg-white/8 px-3 text-[11px] font-semibold text-white/84 transition ${
                        isBottomDockDisabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-white/12'
                      }`}
                    >
                      자세히
                    </button>
                  </div>
                </section>
              </div>
            </section>
          </div>
        </div>
      </main>

      <footer className="relative border-t border-white/10 bg-[rgba(10,14,22,0.96)]">
        <div
          className="jsx-2df9a19167547992 mx-auto w-full max-w-[430px] px-4 pb-4 pt-6 text-white/72"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
        >
          <p className="jsx-2df9a19167547992 text-sm font-semibold text-white/88">Vote War Map</p>
          <p className="jsx-2df9a19167547992 mt-2 text-xs text-white/60">© 2026 Vote War Map. All rights reserved.</p>
          <p className="jsx-2df9a19167547992 mt-2 text-xs text-white/55">문의/정책 안내 페이지는 추후 업데이트될 예정입니다.</p>
        </div>
      </footer>
    </div>
  );
}
