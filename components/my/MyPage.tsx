'use client';

import { motion, useReducedMotion } from 'framer-motion';
import {
  type CSSProperties,
  type ReactNode,
  type TouchEvent,
  type WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
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
const APP_BG = 'bg-[var(--my-bg)]';
const CARD_BG = 'bg-[var(--my-surface-strong)]';
const TEXT_PRIMARY = 'text-white';
const TEXT_SECONDARY = 'text-[#8E8E93]';
const ACCENT_COLOR = '#FF5C00';

const PAGE_THEME_VARS = {
  '--my-bg': '#070d16',
  '--my-bg-shell': '#0a1220',
  '--my-surface': 'rgba(12,18,28,0.78)',
  '--my-surface-strong': 'rgba(12,18,28,0.86)',
  '--my-surface-soft': 'rgba(255,255,255,0.04)',
  '--my-border': 'rgba(255,255,255,0.14)',
  '--my-border-soft': 'rgba(255,255,255,0.1)',
  '--my-text-main': 'rgba(255,255,255,0.96)',
  '--my-text-muted': 'rgba(255,255,255,0.68)',
  '--my-text-subtle': 'rgba(255,255,255,0.54)',
  '--my-accent': '#ff9f0a',
  '--my-accent-strong': '#ff6b00',
  '--my-accent-soft': 'rgba(255,107,0,0.18)',
  '--my-focus': 'rgba(255,159,10,0.52)',
  '--my-chart-region': '#9d6bff',
  '--my-chart-nation': '#4f8dff',
  '--my-chart-vote': '#ff9f0a',
  '--my-chart-game': '#57c8ff',
  '--my-chart-grid': 'rgba(255,255,255,0.12)',
} as CSSProperties;

const MAIN_VIEW_STYLE = {
  fontFamily: '"Pretendard","Pretendard Variable",var(--font-geist-sans),sans-serif',
} as CSSProperties;

const CARD_CLASS =
  'rounded-[22px] border border-[color:var(--my-border)] bg-[var(--my-surface)] p-4 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-2xl';

const PANEL_CLASS = 'rounded-xl border border-[color:var(--my-border-soft)] bg-[var(--my-surface-soft)] p-3';

const FIELD_CLASS =
  'h-10 w-full rounded-lg border border-[color:var(--my-border)] bg-white/8 px-2.5 text-sm text-[color:var(--my-text-main)] outline-none transition focus:border-[color:var(--my-accent)] focus-visible:ring-2 focus-visible:ring-[var(--my-focus)] disabled:cursor-not-allowed disabled:opacity-60';

const BUTTON_PRIMARY_CLASS =
  'inline-flex h-10 items-center justify-center rounded-lg border border-[color:var(--my-accent)] bg-[var(--my-accent-strong)] px-3 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--my-focus)] disabled:cursor-not-allowed disabled:opacity-60';

const BUTTON_SECONDARY_CLASS =
  'inline-flex h-10 items-center justify-center rounded-lg border border-[color:var(--my-border)] bg-white/8 px-3 text-sm font-semibold text-white/90 transition hover:bg-white/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--my-focus)] disabled:cursor-not-allowed disabled:opacity-60';

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

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString() : '0';
}

function normalizePercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const rounded = Math.round(value * 10) / 10;
  return Math.max(0, Math.min(100, rounded));
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

function isKnownAvatarPreset(value: string | null): value is (typeof AVATAR_PRESETS)[number] {
  return Boolean(value && (AVATAR_PRESETS as readonly string[]).includes(value));
}

function getAvatarEmoji(value: string | null): string {
  if (isKnownAvatarPreset(value)) {
    return AVATAR_EMOJI[value];
  }
  return AVATAR_EMOJI.sun;
}

function getMotionProps(reducedMotion: boolean, delay = 0) {
  return {
    initial: reducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: reducedMotion
      ? { duration: 0 }
      : { duration: 0.24, ease: 'easeOut' as const, delay },
  };
}

type AnimatedSectionProps = {
  children: ReactNode;
  className: string;
  reducedMotion: boolean;
  delay?: number;
};

function AnimatedSection({ children, className, reducedMotion, delay = 0 }: AnimatedSectionProps) {
  const motionProps = getMotionProps(reducedMotion, delay);
  return (
    <motion.section {...motionProps} className={className}>
      {children}
    </motion.section>
  );
}


type MainAnimatedSectionProps = {
  children: ReactNode;
  delay?: number;
};

function MainAnimatedSection({ children, delay = 0 }: MainAnimatedSectionProps) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.section
      initial={reducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reducedMotion ? 0 : 0.4,
        ease: [0.25, 1, 0.5, 1],
        delay: reducedMotion ? 0 : delay,
      }}
    >
      {children}
    </motion.section>
  );
}

function MatchRateGauge({ value, label }: { value: number; label: string }) {
  const reducedMotion = useReducedMotion();
  const radius = 80;
  const circumference = Math.PI * radius;
  const safeValue = Math.max(0, Math.min(100, value));
  const strokeDashoffset = circumference - (safeValue / 100) * circumference;

  return (
    <div className="relative mx-auto mb-2 mt-4 aspect-[2/1] w-full max-w-[220px]" role="img" aria-label={`${label} ${safeValue}%`}>
      <svg className="h-full w-full overflow-visible" viewBox="0 0 200 100">
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#2C2C2E" strokeWidth="18" strokeLinecap="round" />
        <motion.path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke={ACCENT_COLOR}
          strokeWidth="18"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: reducedMotion ? 0 : 1.2, ease: 'easeOut', delay: reducedMotion ? 0 : 0.2 }}
          style={{ filter: `drop-shadow(0px 4px 12px ${ACCENT_COLOR}66)` }}
        />
      </svg>
      <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center text-center">
        <span className="text-[36px] font-black leading-none tracking-tighter text-white">
          {safeValue}
          <span className="ml-1 text-[18px] font-bold text-white/50">%</span>
        </span>
        <span className="mt-1.5 text-[12px] font-semibold text-[#FF5C00]">{label}</span>
      </div>
    </div>
  );
}

function WaffleChart({ value, colorClass }: { value: number; colorClass: string }) {
  const reducedMotion = useReducedMotion();
  const safeValue = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div className="grid w-full grid-cols-10 gap-1.5" role="img" aria-label={`100칸 와플 중 ${safeValue}칸 활성화`}>
      {Array.from({ length: 100 }, (_, index) => {
        const isActive = index < safeValue;
        return (
          <motion.div
            key={index}
            initial={reducedMotion ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reducedMotion ? 0 : 0.2, delay: reducedMotion || !isActive ? 0 : index * 0.005 }}
            className={`aspect-square rounded-[3px] transition-colors duration-500 ${isActive ? colorClass : 'bg-[#2C2C2E]'}`}
          />
        );
      })}
    </div>
  );
}

type MainDashboardProps = {
  dashboard: DashboardResponse;
  privacyShowLeaderboardName: boolean;
  onToggleLeaderboardName: () => void;
  onEditProfile: () => void;
  onOpenHistory: () => void;
  onSignOut: () => Promise<void>;
};

function MainDashboard({ dashboard, privacyShowLeaderboardName, onToggleLeaderboardName, onEditProfile, onOpenHistory, onSignOut }: MainDashboardProps) {
  const reducedMotion = useReducedMotion();
  const myRegionMatchRate = normalizePercent(dashboard.northstar.myRegionMatchRate);
  const nationwideMatchRate = normalizePercent(dashboard.northstar.nationwideMatchRate);
  const remainXp = Math.max(dashboard.level.nextXp - dashboard.level.xp, 0);
  const regionLabel = dashboard.profile.region.name ?? '지역 미설정';
  const regionParts = regionLabel.split(' ').filter(Boolean);
  const regionShort = regionParts.length > 0 ? regionParts[regionParts.length - 1] : '내 지역';

  return (
    <div className={`${APP_BG} ${TEXT_PRIMARY}`}>
      <header className="mb-8 pl-1">
        <h1 className="text-3xl font-bold tracking-tight">마이페이지</h1>
      </header>

      <MainAnimatedSection delay={0.1}>
        <div className="mb-10 flex flex-col items-center">
          <div className="relative mb-4">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#1C1C1E] text-[40px] shadow-lg">
              {dashboard.profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={dashboard.profile.avatarUrl} alt="프로필" className="h-full w-full rounded-full object-cover" />
              ) : (
                getAvatarEmoji(dashboard.profile.avatarPreset)
              )}
            </div>
            <div className="absolute -bottom-2 -right-2 rounded-full border-2 border-black bg-[#FF5C00] px-3 py-1 text-[11px] font-bold text-white shadow-md">
              {tierLabel(dashboard.level.tier)}
            </div>
          </div>
          <h2 className="text-2xl font-bold">{dashboard.profile.name}</h2>
          <p className={`mt-1 text-sm ${TEXT_SECONDARY}`}>
            @{dashboard.profile.username} · {regionLabel}
          </p>

          <button
            type="button"
            onClick={onEditProfile}
            className="mt-3.5 rounded-full bg-[#2C2C2E] px-4 py-1.5 text-[13px] font-medium text-white transition-colors active:scale-95 hover:bg-[#3A3A3C]"
          >
            프로필 편집
          </button>

          <div className="mt-6 w-full max-w-[240px]">
            <div className="mb-1.5 flex justify-between text-[11px] font-semibold text-[#8E8E93]">
              <span>{formatNumber(dashboard.level.xp)} XP</span>
              <span>{formatNumber(dashboard.level.nextXp)} XP</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#2C2C2E]">
              <motion.div
                className="h-full rounded-full bg-[#FF5C00]"
                initial={{ width: 0 }}
                animate={{ width: `${dashboard.level.progressPercent}%` }}
                transition={{ duration: reducedMotion ? 0 : 1, delay: reducedMotion ? 0 : 0.3 }}
              />
            </div>
            <p className="mt-2 text-center text-[11px] text-[#8E8E93]">다음 티어까지 {formatNumber(remainXp)} XP</p>
          </div>
        </div>
      </MainAnimatedSection>

      <MainAnimatedSection delay={0.2}>
        <div className="mb-10 flex items-center justify-between px-2">
          <div className="flex-1 text-center">
            <p className={`mb-1 text-[11px] font-medium ${TEXT_SECONDARY}`}>총 투표수</p>
            <p className="text-xl font-bold">{formatNumber(dashboard.stats.totalVotes)}</p>
          </div>
          <div className="h-8 w-px bg-[#2C2C2E]" />
          <div className="flex-1 text-center">
            <p className={`mb-1 text-[11px] font-medium ${TEXT_SECONDARY}`}>게임점수</p>
            <p className="text-xl font-bold">{formatNumber(dashboard.stats.totalGameScore)}</p>
          </div>
          <div className="h-8 w-px bg-[#2C2C2E]" />
          <div className="flex-1 text-center">
            <p className={`mb-1 text-[11px] font-medium ${TEXT_SECONDARY}`}>지역 순위</p>
            <p className="text-xl font-bold text-[#FF5C00]">{dashboard.stats.gameRankRegionBattle}위</p>
          </div>
        </div>
      </MainAnimatedSection>

      <MainAnimatedSection delay={0.3}>
        <div className={`${CARD_BG} mb-8 rounded-[32px] p-7 shadow-sm`}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-bold">동네 대세 지수</h3>
            <span className="rounded-full bg-[#FF5C00]/10 px-2.5 py-1 text-[11px] font-semibold text-[#FF5C00]">일치율 분석</span>
          </div>

          <p className={`${TEXT_SECONDARY} mb-6 text-sm leading-relaxed`}>
            나의 선택이 사람들과 얼마나 비슷할까요?
            <br />
            우리 동네 사람들과의 일치율을 확인해보세요.
          </p>

          <MatchRateGauge value={myRegionMatchRate} label={`${regionShort} 일치율`} />

          <div className="my-8 h-px w-full bg-[#2C2C2E]" />

          <div className="space-y-7">
            <h4 className="mb-2 text-center text-[13px] font-bold text-white/90">100명 중 몇 명이 나와 같을까?</h4>

            <div>
              <div className="mb-2 flex items-end justify-between">
                <span className="text-xs font-medium text-[#8E8E93]">전국 평균</span>
                <span className="text-xs font-bold text-[#8E8E93]">{Math.round(nationwideMatchRate)}명</span>
              </div>
              <WaffleChart value={nationwideMatchRate} colorClass="bg-white/20" />
            </div>

            <div>
              <div className="mb-2 flex items-end justify-between">
                <span className="text-xs font-medium text-[#FF5C00]">{regionLabel}</span>
                <span className="text-xs font-bold text-[#FF5C00]">{Math.round(myRegionMatchRate)}명</span>
              </div>
              <WaffleChart value={myRegionMatchRate} colorClass="bg-[#FF5C00] shadow-[0_0_10px_rgba(255,92,0,0.4)]" />
            </div>
          </div>
        </div>
      </MainAnimatedSection>

      <MainAnimatedSection delay={0.4}>
        <h3 className="mb-2 ml-4 text-[13px] font-semibold uppercase tracking-wider text-[#8E8E93]">설정 및 기록</h3>
        <div className={`${CARD_BG} overflow-hidden rounded-3xl`}>
          <button
            type="button"
            onClick={onOpenHistory}
            className="flex w-full cursor-pointer items-center justify-between border-b border-[#2C2C2E] p-4 px-5 text-left transition-colors hover:bg-white/5"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2C2C2E] text-sm">📜</div>
              <span className="text-[15px] font-medium">투표 / 게임 히스토리</span>
            </div>
            <span className="text-lg text-[#8E8E93]">›</span>
          </button>

          <div className="flex items-center justify-between border-b border-[#2C2C2E] p-4 px-5">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2C2C2E] text-sm">👁️</div>
              <span className="text-[15px] font-medium">리더보드 이름 공개</span>
            </div>
            <button
              type="button"
              onClick={onToggleLeaderboardName}
              aria-pressed={privacyShowLeaderboardName}
              className={`relative h-7 w-12 rounded-full transition-colors ${privacyShowLeaderboardName ? 'bg-[#FF5C00]' : 'bg-[#2C2C2E]'}`}
            >
              <motion.div
                className="absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm"
                animate={{ left: privacyShowLeaderboardName ? '24px' : '4px' }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            </button>
          </div>

          <button
            type="button"
            onClick={() => void onSignOut()}
            className="flex w-full cursor-pointer items-center justify-between p-4 px-5 text-left text-[#FF3B30] transition-colors hover:bg-white/5"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FF3B30]/10 text-sm">👋</div>
              <span className="text-[15px] font-medium">로그아웃</span>
            </div>
          </button>
        </div>
      </MainAnimatedSection>
    </div>
  );
}

type HeaderProps = {
  notice: string | null;
  error: string | null;
  reducedMotion: boolean;
};

function Header({ notice, error, reducedMotion }: HeaderProps) {
  const motionProps = getMotionProps(reducedMotion, 0);

  return (
    <motion.header
      {...motionProps}
      className="rounded-[24px] border border-[color:var(--my-border)] bg-[var(--my-surface-strong)] p-4 shadow-[0_10px_26px_rgba(0,0,0,0.32)] backdrop-blur-2xl"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#ffd29c]">MY 대시보드</p>
      <h1 className="mt-1 text-[22px] font-bold leading-tight text-[color:var(--my-text-main)]">내 계정 상태와 최근 활동을 관리</h1>
      <p className="mt-1 text-xs text-[color:var(--my-text-muted)]">프로필, 활동 통계, 공개 범위를 이 화면에서 한 번에 수정할 수 있습니다.</p>

      {notice ? <p className="mt-2 text-xs text-[#ffd7b5]">{notice}</p> : null}
      {error ? <p className="mt-2 text-xs text-[#ffb4b4]">{error}</p> : null}
    </motion.header>
  );
}

type SettingsCardProps = {
  dashboard: DashboardResponse;
  nicknameInput: string;
  usernameInput: string;
  privacyShowLeaderboardName: boolean;
  privacyShowRegion: boolean;
  privacyShowActivityHistory: boolean;
  isSaveDirty: boolean;
  isSavingAny: boolean;
  isResolvingRegion: boolean;
  onNicknameChange: (value: string) => void;
  onUsernameChange: (value: string) => void;
  onPrivacyShowLeaderboardNameChange: (value: boolean) => void;
  onPrivacyShowRegionChange: (value: boolean) => void;
  onPrivacyShowActivityHistoryChange: (value: boolean) => void;
  onSaveAll: () => Promise<void>;
  onCancelEdits: () => void;
  onResolveCurrentRegion: () => Promise<void>;
  onSignOut: () => Promise<void>;
  reducedMotion: boolean;
  delay?: number;
};

function SettingsCard({
  dashboard,
  nicknameInput,
  usernameInput,
  privacyShowLeaderboardName,
  privacyShowRegion,
  privacyShowActivityHistory,
  isSaveDirty,
  isSavingAny,
  isResolvingRegion,
  onNicknameChange,
  onUsernameChange,
  onPrivacyShowLeaderboardNameChange,
  onPrivacyShowRegionChange,
  onPrivacyShowActivityHistoryChange,
  onSaveAll,
  onCancelEdits,
  onResolveCurrentRegion,
  onSignOut,
  reducedMotion,
  delay = 0.12,
}: SettingsCardProps) {
  return (
    <AnimatedSection className={CARD_CLASS} reducedMotion={reducedMotion} delay={delay}>
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#ffcf98]">개인정보 수정</h2>

      <section className={`${PANEL_CLASS} mt-2`} aria-labelledby="account-settings-title">
        <h3 id="account-settings-title" className="text-[12px] font-semibold text-white/84">
          기본 정보
        </h3>

        <label htmlFor="my-nickname-input" className="mt-2 block">
          <span className="mb-1 block text-[11px] text-[color:var(--my-text-muted)]">닉네임</span>
          <input
            id="my-nickname-input"
            value={nicknameInput}
            onChange={(event) => onNicknameChange(event.target.value)}
            maxLength={20}
            className={FIELD_CLASS}
            autoComplete="nickname"
          />
        </label>

        <label htmlFor="my-username-input" className="mt-2 block">
          <span className="mb-1 block text-[11px] text-[color:var(--my-text-muted)]">사용자명</span>
          <input
            id="my-username-input"
            value={usernameInput}
            onChange={(event) => onUsernameChange(event.target.value)}
            className={FIELD_CLASS}
            autoComplete="username"
            disabled
            readOnly
          />
          <span className="mt-1 block text-[10px] text-[color:var(--my-text-subtle)]">사용자명은 변경할 수 없습니다.</span>
        </label>
      </section>

      <section className={`${PANEL_CLASS} mt-2`} aria-labelledby="region-settings-title">
        <h3 id="region-settings-title" className="text-[12px] font-semibold text-white/84">
          지역 설정
        </h3>
        <p className="mt-2 text-[12px] text-[color:var(--my-text-muted)]">현재 지역: {dashboard.profile.region.name ?? '미설정'}</p>
        <button
          type="button"
          onClick={() => void onResolveCurrentRegion()}
          disabled={isResolvingRegion || isSavingAny}
          aria-disabled={isResolvingRegion || isSavingAny}
          className={`${BUTTON_SECONDARY_CLASS} mt-2 w-full`}
        >
          {isResolvingRegion ? '위치 확인 중...' : '현재 위치로 자동 설정'}
        </button>
      </section>

      <section className={`${PANEL_CLASS} mt-2`} aria-labelledby="privacy-settings-title">
        <h3 id="privacy-settings-title" className="text-[12px] font-semibold text-white/84">
          공개 범위
        </h3>

        <label className="mt-2 flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-[color:var(--my-border-soft)] bg-white/[0.03] px-2.5 py-2 text-[12px] text-white/82">
          <span>
            <span className="block">리더보드 닉네임 공개</span>
            <span className="mt-0.5 block text-[10px] text-[color:var(--my-text-subtle)]">다른 사용자가 리더보드에서 닉네임을 볼 수 있습니다.</span>
          </span>
          <input
            type="checkbox"
            checked={privacyShowLeaderboardName}
            onChange={(event) => onPrivacyShowLeaderboardNameChange(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--my-accent)]"
          />
        </label>

        <label className="mt-1.5 flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-[color:var(--my-border-soft)] bg-white/[0.03] px-2.5 py-2 text-[12px] text-white/82">
          <span>
            <span className="block">내 지역 공개</span>
            <span className="mt-0.5 block text-[10px] text-[color:var(--my-text-subtle)]">통계 화면에서 내 지역 정보가 노출됩니다.</span>
          </span>
          <input
            type="checkbox"
            checked={privacyShowRegion}
            onChange={(event) => onPrivacyShowRegionChange(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--my-accent)]"
          />
        </label>

        <label className="mt-1.5 flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-[color:var(--my-border-soft)] bg-white/[0.03] px-2.5 py-2 text-[12px] text-white/82">
          <span>
            <span className="block">활동 히스토리 공개</span>
            <span className="mt-0.5 block text-[10px] text-[color:var(--my-text-subtle)]">프로필에서 투표/게임 기록이 보일 수 있습니다.</span>
          </span>
          <input
            type="checkbox"
            checked={privacyShowActivityHistory}
            onChange={(event) => onPrivacyShowActivityHistoryChange(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--my-accent)]"
          />
        </label>
      </section>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void onSaveAll()}
          disabled={isSavingAny}
          aria-disabled={isSavingAny}
          className={`${BUTTON_PRIMARY_CLASS} w-full`}
        >
          {isSavingAny ? '저장 중...' : '수정 완료'}
        </button>
        <button
          type="button"
          onClick={onCancelEdits}
          disabled={!isSaveDirty || isSavingAny}
          aria-disabled={!isSaveDirty || isSavingAny}
          className={`${BUTTON_SECONDARY_CLASS} w-full`}
        >
          취소
        </button>
      </div>

      <button
        type="button"
        onClick={() => void onSignOut()}
        className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl border border-[color:var(--my-border)] bg-white/8 text-sm font-semibold text-white/90 transition hover:bg-white/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--my-focus)]"
      >
        로그아웃
      </button>
    </AnimatedSection>
  );
}

type BottomDockProps = {
  bottomDockRef: React.RefObject<HTMLDivElement | null>;
  onTabClick: (tab: 'home' | 'map' | 'game' | 'my') => void;
  onWheel: (event: WheelEvent<HTMLElement>) => void;
  onTouchStart: (event: TouchEvent<HTMLElement>) => void;
  onTouchMove: (event: TouchEvent<HTMLElement>) => void;
  onTouchEnd: () => void;
};

function BottomDock({ bottomDockRef, onTabClick, onWheel, onTouchStart, onTouchMove, onTouchEnd }: BottomDockProps) {
  return (
    <div ref={bottomDockRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-[130] md:hidden">
      <div
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        className="pointer-events-auto"
        style={{ touchAction: 'pan-y' }}
      >
        <nav className="rounded-t-[24px] border-t border-white/14 bg-[rgba(12,18,28,0.82)] pb-2 pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.32)] backdrop-blur-2xl" aria-label="하단 탭 메뉴">
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
                onClick={() => onTabClick(tab.id)}
                aria-current={tab.id === 'my' ? 'page' : undefined}
                className={`inline-flex h-11 items-center justify-center rounded-2xl text-[14px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--my-focus)] ${
                  tab.id === 'my' ? 'bg-white/14 text-[#ff9f0a]' : 'text-white/62 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </nav>

        <section className="border-t border-white/14 bg-[rgba(12,18,28,0.82)] pb-[calc(0.55rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.32)] backdrop-blur-2xl" aria-label="스폰서 배너">
          <div className="mx-auto max-w-[430px] px-3">
            <section className="rounded-xl border border-white/14 bg-[rgba(255,255,255,0.06)] px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-6 shrink-0 items-center rounded-md border border-[#ff9f0a66] bg-[#ff9f0a22] px-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#ffcc8a]">
                  광고
                </span>
                <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-white/80">스폰서 배너 영역입니다.</p>
                <button
                  type="button"
                  className="inline-flex h-11 shrink-0 items-center rounded-lg border border-white/18 bg-white/8 px-3 text-[11px] font-semibold text-white/84 transition hover:bg-white/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--my-focus)]"
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
}

function Footer() {
  return (
    <footer className="relative border-t border-white/10 bg-[rgba(10,14,22,0.96)]">
      <div className="mx-auto w-full max-w-[430px] px-4 pb-4 pt-6 text-white/72" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
        <p className="text-sm font-semibold text-white/88">Vote War Map</p>
        <p className="mt-2 text-xs text-white/60">© 2026 Vote War Map. All rights reserved.</p>
        <p className="mt-2 text-xs text-white/55">문의/정책 안내 페이지는 추후 업데이트될 예정입니다.</p>
      </div>
    </footer>
  );
}

type PolicyModalProps = {
  isOpen: boolean;
  pendingRegion: ReverseRegionResponse | null;
  onKeepSchool: () => Promise<void>;
  onClearSchool: () => Promise<void>;
  onClose: () => void;
};

function PolicyModal({ isOpen, pendingRegion, onKeepSchool, onClearSchool, onClose }: PolicyModalProps) {
  if (!isOpen || !pendingRegion) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[160] flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="region-policy-title">
      <div className="w-full max-w-[420px] rounded-[24px] border border-[color:var(--my-border)] bg-[rgba(14,20,30,0.94)] p-4 shadow-[0_16px_36px_rgba(0,0,0,0.38)] backdrop-blur-2xl">
        <h3 id="region-policy-title" className="text-[17px] font-bold text-white">
          지역 업데이트 방식 선택
        </h3>
        <p className="mt-2 text-sm text-white/76">
          현재 위치를 <span className="font-semibold text-white">{pendingRegion.sigunguName ?? pendingRegion.sidoName ?? pendingRegion.sidoCode}</span>으로 인식했습니다.
        </p>
        <p className="mt-1 text-xs text-white/58">학교 정보를 유지할지, 해제할지 선택해 주세요.</p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void onKeepSchool()}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-[color:var(--my-border)] bg-white/8 text-sm font-semibold text-white/90 transition hover:bg-white/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--my-focus)]"
          >
            학교 유지
          </button>
          <button
            type="button"
            onClick={() => void onClearSchool()}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-[color:var(--my-accent)] bg-[var(--my-accent-strong)] text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--my-focus)]"
          >
            학교 해제
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-lg border border-[color:var(--my-border)] bg-white/5 text-xs font-semibold text-white/72 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--my-focus)]"
        >
          취소
        </button>
      </div>
    </div>
  );
}

export default function MyPage() {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const { isLoading: isAuthLoading, isAuthenticated, signOut } = useAuth();
  const reducedMotion = useReducedMotion();

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

  const [privacyShowLeaderboardName, setPrivacyShowLeaderboardName] = useState(true);
  const [privacyShowRegion, setPrivacyShowRegion] = useState(false);
  const [privacyShowActivityHistory, setPrivacyShowActivityHistory] = useState(false);

  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPrivacy, setIsSavingPrivacy] = useState(false);
  const [isResolvingRegion, setIsResolvingRegion] = useState(false);

  const [isPolicyModalOpen, setIsPolicyModalOpen] = useState(false);
  const [pendingRegion, setPendingRegion] = useState<ReverseRegionResponse | null>(null);
  const [bottomDockHeight, setBottomDockHeight] = useState(0);
  const isEditRoute = pathname === '/my/edit';

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
      const nextPath = encodeURIComponent(pathname || '/my');
      router.replace(`/auth?next=${nextPath}`);
      return;
    }
    void loadMyData();
  }, [isAuthLoading, isAuthenticated, loadMyData, pathname, router]);

  useEffect(() => {
    if (!dashboard) {
      return;
    }

    setNicknameInput(dashboard.profile.nickname ?? '');
    setUsernameInput(dashboard.profile.username ?? '');

    setPrivacyShowLeaderboardName(dashboard.privacy.showLeaderboardName);
    setPrivacyShowRegion(dashboard.privacy.showRegion);
    setPrivacyShowActivityHistory(dashboard.privacy.showActivityHistory);
  }, [dashboard]);

  const isProfileDirty = useMemo(() => {
    if (!dashboard) {
      return false;
    }

    return nicknameInput.trim() !== (dashboard.profile.nickname ?? '');
  }, [dashboard, nicknameInput]);

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

  const isSettingsDirty = isProfileDirty || isPrivacyDirty;
  const isSavingAny = isSavingProfile || isSavingPrivacy;

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

  const handleSaveAll = useCallback(async () => {
    if (!dashboard) {
      return;
    }

    if (!isSettingsDirty) {
      setNotice('변경된 내용이 없습니다.');
      return;
    }

    const token = await getAccessToken();
    if (!token) {
      setNotice('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
      return;
    }

    setIsSavingProfile(isProfileDirty);
    setIsSavingPrivacy(isPrivacyDirty);
    try {
      if (isProfileDirty) {
        const profilePayload: Record<string, unknown> = {};
        if (nicknameInput.trim() !== (dashboard.profile.nickname ?? '')) {
          profilePayload.nickname = nicknameInput.trim();
        }

        if (Object.keys(profilePayload).length > 0) {
          const profileResponse = await fetch('/api/me/profile', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(profilePayload),
          });

          const profileJson = (await profileResponse.json()) as { error?: string };
          if (!profileResponse.ok) {
            setNotice(profileJson.error ?? '기본 정보 저장에 실패했습니다.');
            return;
          }
        }
      }

      if (isPrivacyDirty) {
        const privacyResponse = await fetch('/api/me/privacy', {
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

        const privacyJson = (await privacyResponse.json()) as { error?: string };
        if (!privacyResponse.ok) {
          setNotice(privacyJson.error ?? '공개 범위 저장에 실패했습니다.');
          return;
        }
      }

      await loadMyData();
      setNotice('수정사항을 저장했습니다.');
    } finally {
      setIsSavingProfile(false);
      setIsSavingPrivacy(false);
    }
  }, [
    dashboard,
    getAccessToken,
    isPrivacyDirty,
    isProfileDirty,
    isSettingsDirty,
    loadMyData,
    nicknameInput,
    privacyShowActivityHistory,
    privacyShowLeaderboardName,
    privacyShowRegion,
  ]);

  const handleCancelEdits = useCallback(() => {
    if (!dashboard) {
      return;
    }

    setNicknameInput(dashboard.profile.nickname ?? '');
    setUsernameInput(dashboard.profile.username ?? '');
    setPrivacyShowLeaderboardName(dashboard.privacy.showLeaderboardName);
    setPrivacyShowRegion(dashboard.privacy.showRegion);
    setPrivacyShowActivityHistory(dashboard.privacy.showActivityHistory);
    setNotice('변경사항을 취소했습니다.');
  }, [dashboard]);

  const handleScrollToSettings = useCallback(() => {
    router.push('/my/edit');
  }, [router]);

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

  const bottomDockPaddingStyle = useMemo(() => ({ paddingBottom: `${Math.max(bottomDockHeight + 12, 120)}px` }), [bottomDockHeight]);

  if (isAuthLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--my-bg)] text-white" style={PAGE_THEME_VARS}>
        <p className="text-sm text-[color:var(--my-text-muted)]">MY 정보를 준비 중...</p>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--my-bg)] text-white" style={PAGE_THEME_VARS}>
        <p className="text-sm text-[color:var(--my-text-muted)]">로그인 페이지로 이동 중...</p>
      </main>
    );
  }

  return (
    <div className="bg-[var(--my-bg)] text-white" style={PAGE_THEME_VARS}>
      <main className="relative h-screen w-full overflow-hidden bg-[var(--my-bg)] text-white">
        <div
          className="mx-auto flex h-full w-full max-w-[430px] flex-col overflow-y-auto px-4 pb-4 pt-[calc(0.5rem+env(safe-area-inset-top))] md:max-w-[680px] md:px-6"
          style={bottomDockPaddingStyle}
        >
          {isLoading ? (
            <section className="mt-3 space-y-3" aria-label="로딩 상태">
              <div className="h-28 animate-pulse rounded-[22px] bg-white/10" />
              <div className="h-36 animate-pulse rounded-[22px] bg-white/10" />
              <div className="h-40 animate-pulse rounded-[22px] bg-white/10" />
            </section>
          ) : dashboard && history ? (
            <>
              {isEditRoute ? (
                <div className="mt-3 space-y-3">
                  <Header notice={notice} error={error} reducedMotion={Boolean(reducedMotion)} />
                  <motion.section
                    {...getMotionProps(Boolean(reducedMotion), 0.03)}
                    className="rounded-[18px] border border-[color:var(--my-border-soft)] bg-[var(--my-surface-soft)] p-3"
                  >
                    <button
                      type="button"
                      onClick={() => router.push('/my')}
                      className="inline-flex h-8 items-center justify-center rounded-lg border border-[color:var(--my-border)] bg-white/8 px-2.5 text-[11px] font-semibold text-white/90 transition hover:bg-white/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--my-focus)]"
                    >
                      ← MY로 돌아가기
                    </button>
                    <p className="mt-2 text-xs text-[color:var(--my-text-muted)]">이 페이지에서 프로필과 공개 범위를 수정합니다.</p>
                  </motion.section>
                  <SettingsCard
                    dashboard={dashboard}
                    nicknameInput={nicknameInput}
                    usernameInput={usernameInput}
                    privacyShowLeaderboardName={privacyShowLeaderboardName}
                    privacyShowRegion={privacyShowRegion}
                    privacyShowActivityHistory={privacyShowActivityHistory}
                    isSaveDirty={isSettingsDirty}
                    isSavingAny={isSavingAny}
                    isResolvingRegion={isResolvingRegion}
                    onNicknameChange={setNicknameInput}
                    onUsernameChange={setUsernameInput}
                    onPrivacyShowLeaderboardNameChange={setPrivacyShowLeaderboardName}
                    onPrivacyShowRegionChange={setPrivacyShowRegion}
                    onPrivacyShowActivityHistoryChange={setPrivacyShowActivityHistory}
                    onSaveAll={handleSaveAll}
                    onCancelEdits={handleCancelEdits}
                    onResolveCurrentRegion={handleResolveCurrentRegion}
                    onSignOut={async () => {
                      await signOut();
                      router.push('/');
                    }}
                    reducedMotion={Boolean(reducedMotion)}
                  />
                </div>
              ) : (
                <div className="pt-8" style={MAIN_VIEW_STYLE}>
                  {notice ? <p className="text-xs text-[#ffd7b5]">{notice}</p> : null}
                  {error ? <p className="text-xs text-[#ffb4b4]">{error}</p> : null}
                  <MainDashboard
                    dashboard={dashboard}
                    privacyShowLeaderboardName={privacyShowLeaderboardName}
                    onToggleLeaderboardName={() => {
                      setPrivacyShowLeaderboardName((prev) => !prev);
                    }}
                    onEditProfile={handleScrollToSettings}
                    onOpenHistory={handleScrollToSettings}
                    onSignOut={async () => {
                      await signOut();
                      router.push('/');
                    }}
                  />
                </div>
              )}
            </>
          ) : null}
        </div>

        <BottomDock
          bottomDockRef={bottomDockRef}
          onTabClick={handleBottomTabClick}
          onWheel={handleBottomDockWheel}
          onTouchStart={handleBottomDockTouchStart}
          onTouchMove={handleBottomDockTouchMove}
          onTouchEnd={handleBottomDockTouchEnd}
        />
      </main>

      <Footer />

      <PolicyModal
        isOpen={isPolicyModalOpen}
        pendingRegion={pendingRegion}
        onKeepSchool={async () => {
          await handleApplyRegionPolicy('keep');
        }}
        onClearSchool={async () => {
          await handleApplyRegionPolicy('clear');
        }}
        onClose={() => {
          setPendingRegion(null);
          setIsPolicyModalOpen(false);
        }}
      />
    </div>
  );
}
