'use client';

import { type TouchEvent, type WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { AVATAR_PRESETS } from '@/lib/vote/constants';

type RegionPayload = {
  sidoCode: string | null;
  sigunguCode: string | null;
  name: string | null;
};

type DashboardResponse = {
  profile: {
    id: string;
    name: string;
    nickname: string | null;
    username: string;
    avatarUrl: string | null;
    avatarPreset: string | null;
    joinedAt: string;
    region: RegionPayload;
  };
  northstar: {
    myRegionMatchRate: number;
    nationwideMatchRate: number;
    dominanceGapDelta: number;
    regionNationalFlow: number;
  };
  stats: {
    totalVotes: number;
    totalGameScore: number;
    gameRankOverall: number;
    gameRankRegionBattle: number;
    recent7Days: {
      votes: number;
      games: number;
      total: number;
    };
    mostActiveRegion:
      | {
          level: 'sido' | 'sigungu';
          code: string;
          name: string | null;
          voteCount: number;
        }
      | null;
  };
  level: {
    tier: 'bronze' | 'silver' | 'gold' | 'platinum';
    xp: number;
    nextXp: number;
    progressPercent: number;
  };
  badges: Array<{
    id: string;
    label: string;
    unlocked: boolean;
    progress: number;
    target: number;
  }>;
  privacy: {
    showLeaderboardName: boolean;
    showRegion: boolean;
    showActivityHistory: boolean;
  };
  error?: string;
};

type HistoryResponse = {
  votes: Array<{
    id: string;
    topicId: string;
    topicTitle: string;
    optionKey: string;
    optionLabel: string;
    votedAt: string;
    region:
      | {
          level: 'sido' | 'sigungu';
          code: string;
          name: string | null;
        }
      | null;
  }>;
  games: Array<{
    id: string;
    source: 'mode' | 'region_battle';
    modeId: string;
    modeLabel: string;
    rawScore: number;
    normalizedScore: number;
    playedAt: string;
  }>;
  badges: Array<{
    id: string;
    label: string;
    unlocked: boolean;
    progress: number;
    target: number;
  }>;
  error?: string;
};

type ReverseRegionResponse = {
  sidoCode: string;
  sigunguCode: string | null;
  sidoName: string | null;
  sigunguName: string | null;
  provider: string;
  error?: string;
};

type RegionPolicy = 'keep' | 'clear';
const DOCK_SCROLL_TOUCH_THRESHOLD_PX = 6;

const AVATAR_EMOJI: Record<(typeof AVATAR_PRESETS)[number], string> = {
  sun: '🌞',
  moon: '🌙',
  star: '⭐',
  leaf: '🍀',
  wave: '🌊',
  fire: '🔥',
  cloud: '☁️',
  spark: '✨',
};

function formatDate(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return '-';
  }

  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(parsed));
}

function formatDateTime(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return '-';
  }

  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(parsed));
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString() : '0';
}

function tierLabel(tier: DashboardResponse['level']['tier']): string {
  if (tier === 'bronze') {
    return '브론즈';
  }
  if (tier === 'silver') {
    return '실버';
  }
  if (tier === 'gold') {
    return '골드';
  }
  return '플래티넘';
}

function metricLabel(value: number, suffix: string): string {
  if (!Number.isFinite(value)) {
    return `0${suffix}`;
  }
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}${suffix}`;
}

export default function MyPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const { isLoading: isAuthLoading, isAuthenticated, signOut } = useAuth();
  const bottomDockRef = useRef<HTMLDivElement | null>(null);
  const dockTouchStartYRef = useRef<number | null>(null);
  const dockTouchLastYRef = useRef<number | null>(null);
  const dockTouchMovedRef = useRef(false);

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [nicknameInput, setNicknameInput] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [avatarPresetInput, setAvatarPresetInput] = useState<(typeof AVATAR_PRESETS)[number]>('sun');

  const [privacyShowLeaderboardName, setPrivacyShowLeaderboardName] = useState(true);
  const [privacyShowRegion, setPrivacyShowRegion] = useState(false);
  const [privacyShowActivityHistory, setPrivacyShowActivityHistory] = useState(false);

  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPrivacy, setIsSavingPrivacy] = useState(false);
  const [isResolvingRegion, setIsResolvingRegion] = useState(false);

  const [isPolicyModalOpen, setIsPolicyModalOpen] = useState(false);
  const [pendingRegion, setPendingRegion] = useState<ReverseRegionResponse | null>(null);
  const [bottomDockHeight, setBottomDockHeight] = useState(0);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    if (!supabase) {
      return null;
    }

    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, [supabase]);

  const loadMyData = useCallback(async () => {
    if (!isAuthenticated) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const token = await getAccessToken();
    if (!token) {
      setError('로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.');
      setIsLoading(false);
      return;
    }

    try {
      const [dashboardRes, historyRes] = await Promise.all([
        fetch('/api/me/dashboard', {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/me/history', {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const dashboardJson = (await dashboardRes.json()) as DashboardResponse;
      const historyJson = (await historyRes.json()) as HistoryResponse;

      if (!dashboardRes.ok) {
        setError(dashboardJson.error ?? '내 대시보드를 불러오지 못했습니다.');
        setDashboard(null);
        setHistory(null);
        setIsLoading(false);
        return;
      }

      if (!historyRes.ok) {
        setError(historyJson.error ?? '내 활동 히스토리를 불러오지 못했습니다.');
        setDashboard(null);
        setHistory(null);
        setIsLoading(false);
        return;
      }

      setDashboard(dashboardJson);
      setHistory(historyJson);
      setError(null);
    } catch {
      setError('내 정보를 불러오지 못했습니다.');
      setDashboard(null);
      setHistory(null);
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken, isAuthenticated]);

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }
    if (!isAuthenticated) {
      router.replace('/auth?next=%2Fmy');
      return;
    }
    void loadMyData();
  }, [isAuthLoading, isAuthenticated, loadMyData, router]);

  useEffect(() => {
    if (!dashboard) {
      return;
    }

    setNicknameInput(dashboard.profile.nickname ?? '');
    setUsernameInput(dashboard.profile.username ?? '');

    const profilePreset = (dashboard.profile.avatarPreset ?? '').trim();
    if ((AVATAR_PRESETS as readonly string[]).includes(profilePreset)) {
      setAvatarPresetInput(profilePreset as (typeof AVATAR_PRESETS)[number]);
    } else {
      setAvatarPresetInput('sun');
    }

    setPrivacyShowLeaderboardName(dashboard.privacy.showLeaderboardName);
    setPrivacyShowRegion(dashboard.privacy.showRegion);
    setPrivacyShowActivityHistory(dashboard.privacy.showActivityHistory);
  }, [dashboard]);

  const isProfileDirty = useMemo(() => {
    if (!dashboard) {
      return false;
    }

    return (
      nicknameInput.trim() !== (dashboard.profile.nickname ?? '') ||
      usernameInput.trim().toLowerCase() !== dashboard.profile.username ||
      avatarPresetInput !== (dashboard.profile.avatarPreset ?? 'sun')
    );
  }, [avatarPresetInput, dashboard, nicknameInput, usernameInput]);

  const isPrivacyDirty = useMemo(() => {
    if (!dashboard) {
      return false;
    }

    return (
      privacyShowLeaderboardName !== dashboard.privacy.showLeaderboardName ||
      privacyShowRegion !== dashboard.privacy.showRegion ||
      privacyShowActivityHistory !== dashboard.privacy.showActivityHistory
    );
  }, [dashboard, privacyShowActivityHistory, privacyShowLeaderboardName, privacyShowRegion]);

  const submitProfilePatch = useCallback(
    async (payload: Record<string, unknown>, successMessage: string) => {
      const token = await getAccessToken();
      if (!token) {
        setNotice('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
        return false;
      }

      const response = await fetch('/api/me/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        setNotice(json.error ?? '프로필 저장에 실패했습니다.');
        return false;
      }

      setNotice(successMessage);
      await loadMyData();
      return true;
    },
    [getAccessToken, loadMyData],
  );

  const handleProfileSave = useCallback(async () => {
    if (!dashboard || !isProfileDirty) {
      return;
    }

    setIsSavingProfile(true);
    try {
      const payload: Record<string, unknown> = {};
      if (nicknameInput.trim() !== (dashboard.profile.nickname ?? '')) {
        payload.nickname = nicknameInput.trim();
      }

      const normalizedUsername = usernameInput.trim().toLowerCase();
      if (normalizedUsername !== dashboard.profile.username) {
        payload.username = normalizedUsername;
      }

      if (avatarPresetInput !== (dashboard.profile.avatarPreset ?? 'sun')) {
        payload.avatarPreset = avatarPresetInput;
      }

      if (Object.keys(payload).length === 0) {
        return;
      }

      await submitProfilePatch(payload, '계정 설정을 저장했습니다.');
    } finally {
      setIsSavingProfile(false);
    }
  }, [avatarPresetInput, dashboard, isProfileDirty, nicknameInput, submitProfilePatch, usernameInput]);

  const handlePrivacySave = useCallback(async () => {
    if (!dashboard || !isPrivacyDirty) {
      return;
    }

    const token = await getAccessToken();
    if (!token) {
      setNotice('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
      return;
    }

    setIsSavingPrivacy(true);
    try {
      const response = await fetch('/api/me/privacy', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          showLeaderboardName: privacyShowLeaderboardName,
          showRegion: privacyShowRegion,
          showActivityHistory: privacyShowActivityHistory,
        }),
      });

      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        setNotice(json.error ?? '개인정보 설정 저장에 실패했습니다.');
        return;
      }

      setNotice('개인정보 설정을 저장했습니다.');
      await loadMyData();
    } finally {
      setIsSavingPrivacy(false);
    }
  }, [
    dashboard,
    getAccessToken,
    isPrivacyDirty,
    loadMyData,
    privacyShowActivityHistory,
    privacyShowLeaderboardName,
    privacyShowRegion,
  ]);

  const handleResolveCurrentRegion = useCallback(async () => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setNotice('현재 위치를 사용할 수 없는 환경입니다.');
      return;
    }

    setIsResolvingRegion(true);
    setNotice(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await fetch('/api/location/reverse-region', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            }),
          });

          const json = (await response.json()) as ReverseRegionResponse;
          if (!response.ok) {
            setNotice(json.error ?? '현재 위치에서 지역을 찾지 못했습니다.');
            setIsResolvingRegion(false);
            return;
          }

          setPendingRegion(json);
          setIsPolicyModalOpen(true);
        } catch {
          setNotice('현재 위치에서 지역을 찾지 못했습니다.');
        } finally {
          setIsResolvingRegion(false);
        }
      },
      () => {
        setNotice('위치 권한이 없거나 위치를 확인할 수 없습니다.');
        setIsResolvingRegion(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 30000,
      },
    );
  }, []);

  const handleApplyRegionPolicy = useCallback(
    async (policy: RegionPolicy) => {
      if (!pendingRegion) {
        return;
      }

      setIsPolicyModalOpen(false);
      setIsSavingProfile(true);
      try {
        await submitProfilePatch(
          {
            region: {
              sidoCode: pendingRegion.sidoCode,
              sigunguCode: pendingRegion.sigunguCode,
              schoolPolicy: policy,
            },
          },
          '현재 위치 기준으로 지역을 업데이트했습니다.',
        );
      } finally {
        setPendingRegion(null);
        setIsSavingProfile(false);
      }
    },
    [pendingRegion, submitProfilePatch],
  );

  const handleBottomTabClick = useCallback(
    (tab: 'home' | 'map' | 'game' | 'my') => {
      if (tab === 'home') {
        router.push('/');
        return;
      }
      if (tab === 'map') {
        router.push('/topics-map?openTopicEditor=1');
        return;
      }
      if (tab === 'game') {
        router.push('/game');
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

  const bottomDockPaddingStyle = useMemo(
    () => ({ paddingBottom: `${Math.max(bottomDockHeight + 12, 120)}px` }),
    [bottomDockHeight],
  );

  const bottomDock = (
    <div ref={bottomDockRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-[130] md:hidden">
      <div
        onWheel={handleBottomDockWheel}
        onTouchStart={handleBottomDockTouchStart}
        onTouchMove={handleBottomDockTouchMove}
        onTouchEnd={handleBottomDockTouchEnd}
        onTouchCancel={handleBottomDockTouchEnd}
        className="pointer-events-auto"
        style={{ touchAction: 'pan-y' }}
      >
        <nav className="rounded-t-[24px] border-t border-white/14 bg-[rgba(12,18,28,0.82)] pb-2 pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
          <div className="mx-auto grid max-w-[430px] grid-cols-4 gap-2 px-3">
            {[
              { id: 'home' as const, label: '홈' },
              { id: 'map' as const, label: '지도' },
              { id: 'game' as const, label: '게임' },
              { id: 'my' as const, label: 'MY' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleBottomTabClick(tab.id)}
                className={`inline-flex h-11 items-center justify-center rounded-2xl text-[14px] font-semibold transition ${
                  tab.id === 'my' ? 'bg-white/14 text-[#ff9f0a]' : 'text-white/62 hover:text-white'
                }`}
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
                  className="inline-flex h-11 shrink-0 items-center rounded-lg border border-white/18 bg-white/8 px-3 text-[11px] font-semibold text-white/84 transition hover:bg-white/12"
                >
                  자세히
                </button>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  );

  const pageFooter = (
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
  );

  if (isAuthLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#070d16] text-white">
        <p className="text-sm text-white/70">MY 정보를 준비 중...</p>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#070d16] text-white">
        <p className="text-sm text-white/70">로그인 페이지로 이동 중...</p>
      </main>
    );
  }

  return (
    <div className="bg-black text-white">
      <main className="relative h-screen w-full overflow-hidden bg-[#070d16] text-white">
        <div
          className="mx-auto flex h-full w-full max-w-[430px] flex-col overflow-y-auto px-4 pb-4 pt-[calc(0.5rem+env(safe-area-inset-top))]"
          style={bottomDockPaddingStyle}
        >
          <header className="rounded-[24px] border border-white/14 bg-[rgba(12,18,28,0.82)] p-4 shadow-[0_10px_26px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#ffd29c]">MY 대시보드</p>
            <h1 className="mt-1 text-[22px] font-bold leading-tight">우리 지역 vs 전국 관점으로 내 활동 보기</h1>
            {notice ? <p className="mt-2 text-xs text-[#ffd7b5]">{notice}</p> : null}
            {error ? <p className="mt-2 text-xs text-[#ffb4b4]">{error}</p> : null}
          </header>

          {isLoading ? (
            <section className="mt-3 space-y-3">
              <div className="h-24 animate-pulse rounded-[22px] bg-white/10" />
              <div className="h-32 animate-pulse rounded-[22px] bg-white/10" />
              <div className="h-36 animate-pulse rounded-[22px] bg-white/10" />
            </section>
          ) : dashboard && history ? (
            <>
              <section className="mt-3 rounded-[22px] border border-white/12 bg-[rgba(12,18,28,0.78)] p-4 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#ffcf98]">우리 vs 전국 4지표</p>
                <div className="mt-2 grid grid-cols-2 gap-2.5">
                  <article className="rounded-xl border border-white/12 bg-white/5 p-2.5">
                    <p className="text-[11px] text-white/65">내 지역 일치도</p>
                    <p className="mt-1 text-[18px] font-black text-[#ffb86d]">{metricLabel(dashboard.northstar.myRegionMatchRate, '%')}</p>
                  </article>
                  <article className="rounded-xl border border-white/12 bg-white/5 p-2.5">
                    <p className="text-[11px] text-white/65">전국 일치도</p>
                    <p className="mt-1 text-[18px] font-black text-[#8dc0ff]">{metricLabel(dashboard.northstar.nationwideMatchRate, '%')}</p>
                  </article>
                  <article className="rounded-xl border border-white/12 bg-white/5 p-2.5">
                    <p className="text-[11px] text-white/65">우세 강도 차이</p>
                    <p className="mt-1 text-[18px] font-black text-white">{metricLabel(dashboard.northstar.dominanceGapDelta, '%p')}</p>
                  </article>
                  <article className="rounded-xl border border-white/12 bg-white/5 p-2.5">
                    <p className="text-[11px] text-white/65">지역↔전국 흐름</p>
                    <p className="mt-1 text-[18px] font-black text-[#7dd5ae]">{metricLabel(dashboard.northstar.regionNationalFlow, '%')}</p>
                  </article>
                </div>
              </section>

            <section className="mt-3 rounded-[22px] border border-white/12 bg-[rgba(12,18,28,0.78)] p-4 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/18 bg-white/10 text-xl">
                  {dashboard.profile.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={dashboard.profile.avatarUrl} alt="프로필" className="h-11 w-11 rounded-full object-cover" />
                  ) : (
                    AVATAR_EMOJI[(dashboard.profile.avatarPreset as (typeof AVATAR_PRESETS)[number]) ?? 'sun']
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[17px] font-bold text-white">{dashboard.profile.name}</p>
                  <p className="truncate text-[12px] text-[#9ec9ff]">@{dashboard.profile.username}</p>
                  <p className="text-[11px] text-white/62">가입일 {formatDate(dashboard.profile.joinedAt)}</p>
                </div>
                <span className="rounded-full border border-white/16 bg-white/8 px-2.5 py-1 text-[11px] font-semibold text-[#ffd9a8]">
                  {tierLabel(dashboard.level.tier)}
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/12">
                <div className="h-full bg-gradient-to-r from-[#ff6b00] to-[#ffb15f]" style={{ width: `${dashboard.level.progressPercent}%` }} />
              </div>
              <p className="mt-2 text-[11px] text-white/68">
                XP {formatNumber(dashboard.level.xp)} / {formatNumber(dashboard.level.nextXp)}
              </p>
              <p className="mt-1 text-[11px] text-white/68">
                내 지역: {dashboard.profile.region.name ?? '미설정'}
              </p>
            </section>

            <section className="mt-3 rounded-[22px] border border-white/12 bg-[rgba(12,18,28,0.78)] p-4 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#ffcf98]">활동 통계</p>
              <div className="mt-2 grid grid-cols-2 gap-2.5 text-sm">
                <article className="rounded-xl border border-white/12 bg-white/5 p-2.5">
                  <p className="text-white/62">총 투표 수</p>
                  <p className="mt-1 text-[18px] font-black">{formatNumber(dashboard.stats.totalVotes)}</p>
                </article>
                <article className="rounded-xl border border-white/12 bg-white/5 p-2.5">
                  <p className="text-white/62">총 게임 점수</p>
                  <p className="mt-1 text-[18px] font-black">{formatNumber(dashboard.stats.totalGameScore)}</p>
                </article>
                <article className="rounded-xl border border-white/12 bg-white/5 p-2.5">
                  <p className="text-white/62">게임 순위(통합)</p>
                  <p className="mt-1 text-[18px] font-black">{dashboard.stats.gameRankOverall > 0 ? `${dashboard.stats.gameRankOverall}위` : '-'}</p>
                </article>
                <article className="rounded-xl border border-white/12 bg-white/5 p-2.5">
                  <p className="text-white/62">게임 순위(지역배틀)</p>
                  <p className="mt-1 text-[18px] font-black">{dashboard.stats.gameRankRegionBattle > 0 ? `${dashboard.stats.gameRankRegionBattle}위` : '-'}</p>
                </article>
              </div>
              <p className="mt-2 text-xs text-white/72">
                최근 7일 활동: 투표 {dashboard.stats.recent7Days.votes}회 · 게임 {dashboard.stats.recent7Days.games}회 · 총 {dashboard.stats.recent7Days.total}회
              </p>
              <p className="mt-1 text-xs text-white/72">
                가장 활발한 지역:{' '}
                {dashboard.stats.mostActiveRegion
                  ? `${dashboard.stats.mostActiveRegion.name ?? dashboard.stats.mostActiveRegion.code} (${dashboard.stats.mostActiveRegion.voteCount}표)`
                  : '데이터 없음'}
              </p>
            </section>

            <section className="mt-3 rounded-[22px] border border-white/12 bg-[rgba(12,18,28,0.78)] p-4 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#ffcf98]">내 활동 히스토리</p>

              <div className="mt-2 rounded-xl border border-white/12 bg-white/5 p-3">
                <p className="text-[12px] font-semibold text-white/84">내가 투표한 항목 ({history.votes.length})</p>
                <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                  {history.votes.length === 0 ? (
                    <p className="text-xs text-white/62">아직 투표 기록이 없습니다.</p>
                  ) : (
                    history.votes.map((vote) => (
                      <article key={vote.id} className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2">
                        <p className="line-clamp-1 text-[12px] font-semibold text-white/88">{vote.topicTitle}</p>
                        <p className="mt-0.5 text-[11px] text-white/70">
                          선택: {vote.optionLabel} · {formatDateTime(vote.votedAt)}
                        </p>
                        {vote.region ? (
                          <p className="mt-0.5 text-[11px] text-white/55">
                            지역: {vote.region.name ?? vote.region.code}
                          </p>
                        ) : null}
                      </article>
                    ))
                  )}
                </div>
              </div>

              <div className="mt-2 rounded-xl border border-white/12 bg-white/5 p-3">
                <p className="text-[12px] font-semibold text-white/84">게임 기록 ({history.games.length})</p>
                <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                  {history.games.length === 0 ? (
                    <p className="text-xs text-white/62">아직 게임 기록이 없습니다.</p>
                  ) : (
                    history.games.map((game) => (
                      <article key={game.id} className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2">
                        <p className="line-clamp-1 text-[12px] font-semibold text-white/88">{game.modeLabel}</p>
                        <p className="mt-0.5 text-[11px] text-white/70">
                          점수: {game.rawScore} (정규 {game.normalizedScore}) · {formatDateTime(game.playedAt)}
                        </p>
                      </article>
                    ))
                  )}
                </div>
              </div>

              <div className="mt-2 rounded-xl border border-white/12 bg-white/5 p-3">
                <p className="text-[12px] font-semibold text-white/84">배지/업적 ({history.badges.length})</p>
                <div className="mt-2 space-y-1.5">
                  {history.badges.map((badge) => (
                    <article
                      key={badge.id}
                      className={`rounded-lg border px-2.5 py-2 text-[11px] ${
                        badge.unlocked
                          ? 'border-[#ff9f0a55] bg-[#ff6b001f] text-[#ffd39f]'
                          : 'border-white/10 bg-white/[0.03] text-white/68'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{badge.label}</span>
                        <span>
                          {badge.progress}/{badge.target}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </section>

            <section className="mt-3 rounded-[22px] border border-white/12 bg-[rgba(12,18,28,0.78)] p-4 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#ffcf98]">설정</p>

              <div className="mt-2 rounded-xl border border-white/12 bg-white/5 p-3">
                <p className="text-[12px] font-semibold text-white/84">계정 설정</p>
                <label className="mt-2 block">
                  <span className="mb-1 block text-[11px] text-white/68">닉네임</span>
                  <input
                    value={nicknameInput}
                    onChange={(event) => setNicknameInput(event.target.value)}
                    maxLength={20}
                    className="h-10 w-full rounded-lg border border-white/14 bg-white/8 px-2.5 text-sm text-white outline-none focus:border-[#ff9f0a66]"
                  />
                </label>

                <label className="mt-2 block">
                  <span className="mb-1 block text-[11px] text-white/68">사용자명 (@username)</span>
                  <input
                    value={usernameInput}
                    onChange={(event) => setUsernameInput(event.target.value)}
                    className="h-10 w-full rounded-lg border border-white/14 bg-white/8 px-2.5 text-sm text-white outline-none focus:border-[#ff9f0a66]"
                  />
                  <span className="mt-1 block text-[10px] text-white/50">영문/숫자/_ 3~20자</span>
                </label>

                <div className="mt-2">
                  <span className="mb-1 block text-[11px] text-white/68">아바타</span>
                  <div className="grid grid-cols-4 gap-1.5">
                    {AVATAR_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setAvatarPresetInput(preset)}
                        className={`inline-flex h-10 items-center justify-center rounded-lg border text-[18px] ${
                          avatarPresetInput === preset
                            ? 'border-[#ff9f0a66] bg-[#ff6b0022]'
                            : 'border-white/12 bg-white/6'
                        }`}
                      >
                        {AVATAR_EMOJI[preset]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleProfileSave()}
                    disabled={!isProfileDirty || isSavingProfile}
                    className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-[#ff9f0a66] bg-[#ff6b00] text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSavingProfile ? '저장 중...' : '계정 저장'}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleResolveCurrentRegion()}
                    disabled={isResolvingRegion || isSavingProfile}
                    className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-white/18 bg-white/8 px-2 text-sm font-semibold text-white/88 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isResolvingRegion ? '위치 확인 중...' : '현재 위치로 지역 업데이트'}
                  </button>
                </div>
              </div>

              <div className="mt-2 rounded-xl border border-white/12 bg-white/5 p-3">
                <p className="text-[12px] font-semibold text-white/84">개인정보 설정</p>

                <label className="mt-2 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[12px] text-white/82">
                  <span>리더보드 닉네임 공개</span>
                  <input
                    type="checkbox"
                    checked={privacyShowLeaderboardName}
                    onChange={(event) => setPrivacyShowLeaderboardName(event.target.checked)}
                    className="h-4 w-4"
                  />
                </label>

                <label className="mt-1.5 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[12px] text-white/82">
                  <span>내 지역 공개</span>
                  <input
                    type="checkbox"
                    checked={privacyShowRegion}
                    onChange={(event) => setPrivacyShowRegion(event.target.checked)}
                    className="h-4 w-4"
                  />
                </label>

                <label className="mt-1.5 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[12px] text-white/82">
                  <span>활동 히스토리 공개</span>
                  <input
                    type="checkbox"
                    checked={privacyShowActivityHistory}
                    onChange={(event) => setPrivacyShowActivityHistory(event.target.checked)}
                    className="h-4 w-4"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => void handlePrivacySave()}
                  disabled={!isPrivacyDirty || isSavingPrivacy}
                  className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-lg border border-[#ff9f0a66] bg-[#ff6b00] text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSavingPrivacy ? '저장 중...' : '개인정보 설정 저장'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  void signOut();
                  router.push('/');
                }}
                className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl border border-white/20 bg-white/8 text-sm font-semibold text-white/90"
              >
                로그아웃
              </button>
            </section>
            </>
          ) : null}
        </div>
        {bottomDock}
      </main>
      {pageFooter}

      {isPolicyModalOpen && pendingRegion ? (
        <div className="fixed inset-0 z-[160] flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-[420px] rounded-[24px] border border-white/14 bg-[rgba(14,20,30,0.94)] p-4 shadow-[0_16px_36px_rgba(0,0,0,0.38)] backdrop-blur-2xl">
            <h3 className="text-[17px] font-bold text-white">지역 업데이트 방식 선택</h3>
            <p className="mt-2 text-sm text-white/76">
              현재 위치를 <span className="font-semibold text-white">{pendingRegion.sigunguName ?? pendingRegion.sidoName ?? pendingRegion.sidoCode}</span>
              으로 인식했습니다.
            </p>
            <p className="mt-1 text-xs text-white/58">학교 정보를 유지할지, 해제할지 선택해 주세요.</p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleApplyRegionPolicy('keep')}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-white/18 bg-white/8 text-sm font-semibold text-white/90"
              >
                학교 유지
              </button>
              <button
                type="button"
                onClick={() => void handleApplyRegionPolicy('clear')}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-[#ff9f0a66] bg-[#ff6b00] text-sm font-semibold text-white"
              >
                학교 해제
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setPendingRegion(null);
                setIsPolicyModalOpen(false);
              }}
              className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-lg border border-white/16 bg-white/5 text-xs font-semibold text-white/72"
            >
              취소
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
