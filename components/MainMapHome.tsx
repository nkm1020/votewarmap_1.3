'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type TouchEvent, type WheelEvent } from 'react';
import type { RegionVoteMap } from '@/components/KoreaAdminMap';
import type { BaseCountryTooltipContext } from '@/components/map/BaseCountryAdminMap';
import type { CountryMapLevel, SupportedCountry } from '@/lib/map/countryMapRegistry';
import {
  BarChart2,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Search,
  Users,
  Zap,
} from 'lucide-react';
import { AccountMenuButton } from '@/components/ui/account-menu-button';
import { AdSenseSlot } from '@/components/ads/AdSenseSlot';
import { DesktopTopHeader } from '@/components/ui/desktop-top-header';
import { SiteLegalFooter } from '@/components/common/SiteLegalFooter';
import { LiveVoteCard } from '@/components/vote/LiveVoteCard';
import CountryTabs from '@/components/map/CountryTabs';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { ADSENSE_SLOTS } from '@/lib/adsense';
import { getCountryMapConfig, resolveSupportedCountry } from '@/lib/map/countryMapRegistry';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  addPendingVoteTopic,
  clearPendingRegionInput,
  readPendingRegionInput,
  readPendingVotes,
  writePendingRegionInput,
} from '@/lib/vote/client-storage';
import { useGuestSessionHeartbeat } from '@/lib/vote/guest-session';
import { resolveVoteRegionInputFromCurrentLocation } from '@/lib/vote/location-region';
import { LOCAL_STORAGE_KEYS } from '@/lib/vote/constants';
import { getOptionSubtext } from '@/lib/vote/option-subtext-map';
import {
  buildViewerVoteState,
  type ResultVisibility,
  type VoteResultSummaryResponse,
  type VoteResultViewer,
} from '@/lib/vote/result-summary';
import type { HomeAnalyticsResponse, SchoolSearchItem, VoteRegionInput, VoteTopic } from '@/lib/vote/types';
import { VoteResultScopeChooser } from '@/components/vote/VoteResultScopeChooser';

const BaseCountryAdminMap = dynamic(() => import('@/components/map/BaseCountryAdminMap'), { ssr: false });

const MAIN_MAP_COLORS = {
  a: 'rgba(255, 90, 0, 0.95)',
  b: 'rgba(30, 120, 255, 0.95)',
  tie: 'rgba(255, 193, 63, 0.95)',
  neutral: 'rgba(42, 34, 30, 0.18)',
} as const;
const DOCK_SCROLL_TOUCH_THRESHOLD_PX = 8;
const HOME_MAP_CACHE_KEY = 'all-live-topics';
const REGION_MODAL_HINT =
  '지역과 결과 비교를 위해 학교를 입력하시거나 정확한 위치 사용을 허용해주세요.';
const REGION_MODAL_GPS_ONLY_HINT = '학교 미설정 계정은 정확한 위치 사용(GPS)으로만 투표할 수 있어요.';
const REGION_MODAL_KR_SCHOOL_ONLY_HINT = '국내 사용자는 GPS 위치 기능이 출시 예정이라 학교 위치로만 투표할 수 있어요.';
const KR_SCHOOL_REQUIRED_FOR_MEMBER_MESSAGE = '국내 사용자는 학교 등록 후 투표할 수 있어요. MY에서 학교를 등록해 주세요.';
const SIGNUP_COMPLETION_REQUIRED_MESSAGE = '투표 전에 회원가입 정보를 먼저 입력해 주세요.';
const PREFERRED_COUNTRY_STORAGE_KEY = 'preferred-country';
const DESKTOP_LEFT_PANEL_MAP_FOCUS_OFFSET_X = 140;

type MainMapHomeProps = {
  initialCountryCode?: string;
};

type TopicCategory = 'food' | 'relationship' | 'work' | 'imagination';
type TopicTab = 'all' | TopicCategory;
type FeaturedTopicMetrics = {
  totalVotes: number;
  realtimeVotes: number;
  score: number;
  lastVoteAt: string | null;
};

type FeaturedResultSummaryResponse = VoteResultSummaryResponse;
type TopicVoteViewerState = VoteResultViewer;

type ResultScopeChooserState = {
  topicId: string;
  topicTitle: string;
  scopeCountryCode: SupportedCountry;
  voteCountryCode: SupportedCountry;
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

type DesktopRegionHotTopicsCacheEntry = {
  status: 'loading' | 'success' | 'error';
  topics: RegionHotTopic[];
  error: string | null;
};

type ScoreboardItem = {
  topicId: string;
  title: string;
  status: string;
  totalVotes: number;
  realtimeVotes: number;
  score: number;
  lastVoteAt: string | null;
};

type ScoreboardResponse = {
  items?: ScoreboardItem[];
  error?: string;
};

type RegionStatsSummaryResponse = {
  visibility?: ResultVisibility;
  summary?: {
    totalVotes: number;
    countA?: number;
    countB?: number;
    gapPercent?: number;
  };
};

type HomeAnalyticsApiResponse = HomeAnalyticsResponse & {
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

type VoteRegionInputByGps = Extract<VoteRegionInput, { source: 'gps' }>;

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
  countA?: number;
  countB?: number;
  gapPercent?: number;
}, visibility: ResultVisibility): {
  totalVotes: number;
  countA: number;
  countB: number;
  aPercent: number;
  bPercent: number;
  gapPercent: number;
  hasData: boolean;
} {
  const totalVotes = Math.max(0, Math.trunc(summary.totalVotes ?? 0));
  const countA = Math.max(0, Math.trunc(summary.countA ?? 0));
  const countB = Math.max(0, Math.trunc(summary.countB ?? 0));
  const hasRawCounts = typeof summary.countA === 'number' && typeof summary.countB === 'number';
  if (visibility === 'locked' || totalVotes <= 0 || !hasRawCounts) {
    const gapPercent = typeof summary.gapPercent === 'number' ? Math.max(0, Math.round(summary.gapPercent)) : 0;
    return {
      totalVotes,
      countA,
      countB,
      aPercent: 0,
      bPercent: 0,
      gapPercent,
      hasData: false,
    };
  }

  const aPercent = Math.round((countA / totalVotes) * 100);
  const bPercent = Math.max(0, 100 - aPercent);
  return {
    totalVotes,
    countA,
    countB,
    aPercent,
    bPercent,
    gapPercent: Math.abs(aPercent - bPercent),
    hasData: true,
  };
}

function buildVoteRequestHeaders(
  accessToken: string | null,
  guestSessionId: string | null,
): HeadersInit | undefined {
  const headers: Record<string, string> = {};

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  if (guestSessionId) {
    headers['X-Guest-Session-Id'] = guestSessionId;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

type NormalizedVoteSummary = ReturnType<typeof normalizeSummary>;

function useCountUp(end: number, duration = 2200): string {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const safeEnd = Number.isFinite(end) ? Math.max(0, Math.trunc(end)) : 0;
    let rafId = 0;
    let startTime: number | null = null;

    const animate = (timestamp: number) => {
      if (startTime === null) {
        startTime = timestamp;
      }
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      setCount(Math.floor(progress * safeEnd));
      if (progress < 1) {
        rafId = window.requestAnimationFrame(animate);
      }
    };

    rafId = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(rafId);
  }, [duration, end]);

  return count.toLocaleString();
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

function makeRegionCacheKey(level: 'sido' | 'sigungu', code: string): string {
  return `${level}:${code}`;
}

function toKoreaRegionApiLevel(level: string): 'sido' | 'sigungu' | null {
  if (level === 'sido' || level === 'l1') {
    return 'sido';
  }
  if (level === 'sigungu' || level === 'l2' || level === 'l3') {
    return 'sigungu';
  }
  return null;
}

function formatRegionLevelLabel(level: string): string {
  if (level === 'sido') {
    return '시/도';
  }
  if (level === 'sigungu') {
    return '시/군/구';
  }
  if (level === 'l1') {
    return '1단계';
  }
  if (level === 'l2') {
    return '2단계';
  }
  if (level === 'l3') {
    return '3단계';
  }
  return level;
}

export default function MainMapHome({ initialCountryCode = 'KR' }: MainMapHomeProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'home' | 'map' | 'game' | 'me'>('home');
  const [mapStats, setMapStats] = useState<RegionVoteMap>({});
  const [isStatsLoading, setIsStatsLoading] = useState(true);
  const [summary, setSummary] = useState({
    totalVotes: 0,
    countA: 0,
    countB: 0,
    aPercent: 0,
    bPercent: 0,
    gapPercent: 0,
    hasData: false,
  });
  const [featuredResultVisibility, setFeaturedResultVisibility] = useState<ResultVisibility>('locked');
  const [featuredTopic, setFeaturedTopic] = useState<VoteTopic | null>(null);
  const [featuredMetrics, setFeaturedMetrics] = useState<FeaturedTopicMetrics | null>(null);
  const [isFeaturedLoading, setIsFeaturedLoading] = useState(true);
  const [featuredVoteViewer, setFeaturedVoteViewer] = useState<TopicVoteViewerState>(() =>
    buildViewerVoteState(resolveSupportedCountry(initialCountryCode)),
  );
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [voteMessage, setVoteMessage] = useState<string | null>(null);
  const [isSubmittingVote, setIsSubmittingVote] = useState(false);
  const [isVoteCardCollapsed, setIsVoteCardCollapsed] = useState(true);
  const [isDesktopLeftPanelOpen, setIsDesktopLeftPanelOpen] = useState(true);
  const [isDesktopRightPanelOpen, setIsDesktopRightPanelOpen] = useState(false);
  const [isMapLayoutFullscreen, setIsMapLayoutFullscreen] = useState(false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  const [scoreboardItems, setScoreboardItems] = useState<ScoreboardItem[]>([]);
  const [isScoreboardLoading, setIsScoreboardLoading] = useState(false);
  const [scoreboardError, setScoreboardError] = useState<string | null>(null);
  const [scoreboardTopicSummaries, setScoreboardTopicSummaries] = useState<Record<string, NormalizedVoteSummary>>({});
  const [homeAnalytics, setHomeAnalytics] = useState<HomeAnalyticsResponse['demographics'] | null>(null);
  const [isHomeAnalyticsLoading, setIsHomeAnalyticsLoading] = useState(false);
  const [homeAnalyticsError, setHomeAnalyticsError] = useState<string | null>(null);
  const [expandedHotTopicId, setExpandedHotTopicId] = useState<string | null>(null);
  const [hotTopicVoteMessage, setHotTopicVoteMessage] = useState<string | null>(null);
  const [isHotTopicSubmittingVote, setIsHotTopicSubmittingVote] = useState(false);
  const [hotTopicViewerById, setHotTopicViewerById] = useState<Record<string, TopicVoteViewerState>>({});
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [isSchoolSearching, setIsSchoolSearching] = useState(false);
  const [schoolResults, setSchoolResults] = useState<SchoolSearchItem[]>([]);
  const [schoolQuery, setSchoolQuery] = useState('');
  const [highlightedSchoolIndex, setHighlightedSchoolIndex] = useState(0);
  const [selectedSchool, setSelectedSchool] = useState<SchoolSearchItem | null>(null);
  const [gpsRegionInput, setGpsRegionInput] = useState<VoteRegionInputByGps | null>(null);
  const [isLocatingRegion, setIsLocatingRegion] = useState(false);
  const [profileModalMessage, setProfileModalMessage] = useState<string | null>(null);
  const [voteAfterProfile, setVoteAfterProfile] = useState(false);
  const [guestHasVoted, setGuestHasVoted] = useState(false);
  const [resultScopeChooser, setResultScopeChooser] = useState<ResultScopeChooserState | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<SupportedCountry>(() =>
    resolveSupportedCountry(initialCountryCode),
  );
  const buildResultHref = useCallback((
    topicId: string,
    country: SupportedCountry = selectedCountry,
    extraParams?: Record<string, string | undefined>,
  ) => {
    const query = new URLSearchParams({
      country,
    });
    Object.entries(extraParams ?? {}).forEach(([key, value]) => {
      if (value) {
        query.set(key, value);
      }
    });
    return `/results/${topicId}?${query.toString()}`;
  }, [selectedCountry]);
  const pushResultPage = useCallback((
    topicId: string,
    country?: SupportedCountry,
    extraParams?: Record<string, string | undefined>,
  ) => {
    router.push(buildResultHref(topicId, country, extraParams));
  }, [buildResultHref, router]);
  const [selectedRegion, setSelectedRegion] = useState<{
    code: string;
    name: string;
    level: string;
    stat?: RegionVoteMap[string];
  } | null>(null);
  const [desktopTooltipRegion, setDesktopTooltipRegion] = useState<BaseCountryTooltipContext | null>(null);
  const [regionHotTopics, setRegionHotTopics] = useState<RegionHotTopic[]>([]);
  const [isRegionHotTopicsLoading, setIsRegionHotTopicsLoading] = useState(false);
  const [regionHotTopicsError, setRegionHotTopicsError] = useState<string | null>(null);
  const [desktopRegionHotTopicsCache, setDesktopRegionHotTopicsCache] = useState<
    Record<string, DesktopRegionHotTopicsCacheEntry>
  >({});
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
  const [pendingHotTopicVote, setPendingHotTopicVote] = useState<PendingTopicPickerVote | null>(null);
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
  const desktopRegionHotTopicsCacheRef = useRef<Record<string, DesktopRegionHotTopicsCacheEntry>>({});
  const desktopRegionHotTopicsInFlightRef = useRef<Map<string, AbortController>>(new Map());
  const schoolResultsListRef = useRef<HTMLDivElement | null>(null);
  const dockTouchStartYRef = useRef<number | null>(null);
  const dockTouchLastYRef = useRef<number | null>(null);
  const dockTouchMovedRef = useRef(false);
  const manualCountrySelectionRef = useRef(false);
  const previousViewerCountryRef = useRef<SupportedCountry | null>(null);
  const bottomDockHeight = useMemo(() => bottomAdHeight + bottomMenuHeight, [bottomAdHeight, bottomMenuHeight]);

  const { isAuthenticated, profile, requiresSignupCompletion } = useAuth();
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === 'dark';
  const mobileTopicHintPalette = isDarkTheme
    ? {
      textColor: '#ffd2a6',
      textShadow: '0 2px 10px rgba(255, 107, 0, 0.18)',
      svgFilter: 'drop-shadow(0 0 10px rgba(255, 159, 10, 0.2))',
      chevronStrokePrimary: '#ff9f0a',
      chevronStrokeSecondary: 'rgba(255, 167, 64, 0.95)',
      chevronStrokeTertiary: 'rgba(255, 189, 120, 0.88)',
      chevronStrokeWidth: 3,
    }
    : {
      textColor: '#c76600',
      textShadow: '0 1px 0 rgba(255, 255, 255, 0.72), 0 4px 12px rgba(255, 122, 0, 0.24)',
      svgFilter: 'drop-shadow(0 0 8px rgba(255, 145, 0, 0.22)) drop-shadow(0 4px 16px rgba(255, 145, 0, 0.18))',
      chevronStrokePrimary: '#d96a00',
      chevronStrokeSecondary: 'rgba(244, 130, 24, 0.98)',
      chevronStrokeTertiary: 'rgba(255, 168, 84, 0.94)',
      chevronStrokeWidth: 3.4,
    };
  const topicPickerPalette = isDarkTheme
    ? {
      activeTabClass: 'border-[#ff9f0a66] bg-[#ff9f0a2b] text-[#ffd29c]',
      actionPillClass: 'border-[#ff9f0a55] bg-[#ff9f0a26] text-[#ffd2a6]',
      expandedCardClass: 'border-[#ff9f0a55] bg-[color:var(--app-surface-soft-strong)]',
      optionASelectedClass: 'border-[#ff9f0a88] bg-[#ff6b0030] text-[#ffd9b0]',
      helperTextClass: 'text-[#ffd0a6]',
      submitClass: 'border-[#ff9f0a66] bg-[#ff6b00] text-white hover:bg-[#ff7b1d]',
    }
    : {
      activeTabClass: 'border-[#d9770659] bg-[#ffb34733] text-[#b85a00] shadow-[inset_0_1px_0_rgba(255,255,255,0.76),0_8px_16px_rgba(217,119,6,0.1)]',
      actionPillClass: 'border-[#d9770666] bg-[#ffb34730] text-[#b85a00] shadow-[inset_0_1px_0_rgba(255,255,255,0.74),0_4px_10px_rgba(217,119,6,0.08)]',
      expandedCardClass: 'border-[#d9770645] bg-[color:var(--app-surface-soft-strong)]',
      optionASelectedClass: 'border-[#d9770673] bg-[#ffb3472e] text-[#a94f00] shadow-[inset_0_1px_0_rgba(255,255,255,0.74),0_6px_14px_rgba(217,119,6,0.08)]',
      helperTextClass: 'text-[#a94f00]',
      submitClass: 'border-[#d9770666] bg-[#d96a00] text-white hover:bg-[#e17a18]',
    };
  const guestSessionId = useGuestSessionHeartbeat({ enabled: !isAuthenticated });
  const viewerCountryCode = (isAuthenticated ? profile?.country_code : initialCountryCode) ?? 'KR';
  const viewerSupportedCountry = resolveSupportedCountry(viewerCountryCode);
  const isKoreaSelected = selectedCountry === 'KR';
  const canUseGpsForViewer = viewerCountryCode.toUpperCase() !== 'KR';
  const hasSavedSchool = Boolean(profile?.school_id);
  const canSkipLocationPrompt = isAuthenticated && hasSavedSchool;
  const canSelectSchoolInModal = !isAuthenticated;
  const isGpsOnlyVoteMode = isAuthenticated && !hasSavedSchool && canUseGpsForViewer;
  const regionModalHintText = !canUseGpsForViewer
    ? REGION_MODAL_KR_SCHOOL_ONLY_HINT
    : isGpsOnlyVoteMode
      ? REGION_MODAL_GPS_ONLY_HINT
      : REGION_MODAL_HINT;
  const buildFallbackViewerState = useCallback((hasTopicVote: boolean): TopicVoteViewerState => ({
    ...buildViewerVoteState(viewerSupportedCountry),
    type: isAuthenticated ? 'user' : guestSessionId ? 'guest' : 'anonymous',
    hasVote: hasTopicVote,
    hasTopicVote,
    hasVoteInScope: hasTopicVote && selectedCountry === viewerSupportedCountry,
    countryCode: viewerSupportedCountry,
    voteCountryCode: hasTopicVote ? viewerSupportedCountry : null,
  }), [guestSessionId, isAuthenticated, selectedCountry, viewerSupportedCountry]);
  const openResultScopeChooser = useCallback(
    (topicId: string, topicTitle: string, voteCountryCode: string | null | undefined) => {
      const normalizedVoteCountry = voteCountryCode
        ? resolveSupportedCountry(voteCountryCode)
        : viewerSupportedCountry;
      setResultScopeChooser({
        topicId,
        topicTitle,
        scopeCountryCode: selectedCountry,
        voteCountryCode: normalizedVoteCountry,
      });
    },
    [selectedCountry, viewerSupportedCountry],
  );
  const closeResultScopeChooser = useCallback(() => {
    setResultScopeChooser(null);
  }, []);
  const handleOpenScopeResult = useCallback(() => {
    if (!resultScopeChooser) {
      return;
    }
    pushResultPage(resultScopeChooser.topicId, resultScopeChooser.scopeCountryCode);
    setResultScopeChooser(null);
  }, [pushResultPage, resultScopeChooser]);
  const handleOpenVoteCountryResult = useCallback(() => {
    if (!resultScopeChooser) {
      return;
    }
    pushResultPage(resultScopeChooser.topicId, resultScopeChooser.voteCountryCode, {
      entry: 'history',
      view: 'map',
    });
    setResultScopeChooser(null);
  }, [pushResultPage, resultScopeChooser]);
  const normalizeViewerState = useCallback((summary?: FeaturedResultSummaryResponse | null): TopicVoteViewerState => {
    const fallback = buildFallbackViewerState(false);
    const viewer = summary?.viewer;
    if (!viewer) {
      return fallback;
    }

    const hasTopicVote = Boolean(viewer.hasTopicVote ?? viewer.hasVote);
    const voteCountryCode = viewer.voteCountryCode
      ? resolveSupportedCountry(viewer.voteCountryCode)
      : hasTopicVote
        ? viewerSupportedCountry
        : null;

    return {
      type: viewer.type ?? fallback.type,
      hasVote: hasTopicVote,
      hasTopicVote,
      hasVoteInScope: Boolean(viewer.hasVoteInScope ?? (hasTopicVote && voteCountryCode === selectedCountry)),
      countryCode: viewer.countryCode ? resolveSupportedCountry(viewer.countryCode) : viewerSupportedCountry,
      voteCountryCode,
    };
  }, [buildFallbackViewerState, selectedCountry, viewerSupportedCountry]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const storedCountry = window.localStorage.getItem(PREFERRED_COUNTRY_STORAGE_KEY)?.trim();
    if (!storedCountry) {
      return;
    }

    manualCountrySelectionRef.current = true;
    setSelectedCountry((prev) => {
      const nextCountry = resolveSupportedCountry(storedCountry);
      return prev === nextCountry ? prev : nextCountry;
    });
  }, []);

  useEffect(() => {
    setSelectedCountry((prev) => {
      const previousViewerCountry = previousViewerCountryRef.current;
      previousViewerCountryRef.current = viewerSupportedCountry;

      if (manualCountrySelectionRef.current) {
        if (previousViewerCountry === null) {
          return prev;
        }
        if (prev !== previousViewerCountry) {
          return prev;
        }
      }

      return prev === viewerSupportedCountry ? prev : viewerSupportedCountry;
    });
  }, [viewerSupportedCountry]);

  const handleCountryTabSelect = useCallback((nextCountry: SupportedCountry) => {
    manualCountrySelectionRef.current = true;
    setSelectedCountry((prev) => (prev === nextCountry ? prev : nextCountry));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(PREFERRED_COUNTRY_STORAGE_KEY, selectedCountry);
  }, [selectedCountry]);

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

  const homeMapCacheKey = useMemo(() => `${HOME_MAP_CACHE_KEY}:${selectedCountry}`, [selectedCountry]);
  const mergedMapStats = useMemo(() => mapStats, [mapStats]);
  const selectedRegionStat = useMemo(() => {
    if (!selectedRegion) {
      return null;
    }
    return selectedRegion.stat ?? mergedMapStats[selectedRegion.code] ?? null;
  }, [mergedMapStats, selectedRegion]);

  useEffect(() => {
    desktopRegionHotTopicsCacheRef.current = desktopRegionHotTopicsCache;
  }, [desktopRegionHotTopicsCache]);

  useEffect(() => {
    const inflightMap = desktopRegionHotTopicsInFlightRef.current;
    return () => {
      inflightMap.forEach((controller) => {
        controller.abort();
      });
      inflightMap.clear();
    };
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
  const topicById = useMemo(() => {
    return new Map(availableTopics.map((topic) => [topic.id, topic]));
  }, [availableTopics]);
  const platformTotalVotes = useMemo(() => {
    return scoreboardItems.reduce((sum, item) => sum + (Number.isFinite(item.totalVotes) ? item.totalVotes : 0), 0);
  }, [scoreboardItems]);
  const animatedPlatformTotalVotes = useCountUp(platformTotalVotes, 2500);
  const popularTopics = useMemo(() => {
    return scoreboardItems.slice(0, 3).map((item, index) => {
      const topic = topicById.get(item.topicId);
      const leftOption = topic?.options.find((option) => option.position === 1) ?? null;
      const rightOption = topic?.options.find((option) => option.position === 2) ?? null;
      const distribution = scoreboardTopicSummaries[item.topicId] ?? null;
      const leftPercent = distribution?.hasData ? distribution.aPercent : 50;
      const rightPercent = distribution?.hasData ? distribution.bPercent : 50;
      const gapPercent = distribution?.gapPercent ?? 0;
      const previewTotalVotes = distribution?.totalVotes ?? item.totalVotes;

      return {
        ...item,
        rank: index + 1,
        isHot: index === 0,
        hasDistribution: Boolean(distribution?.hasData),
        leftLabel: leftOption?.label ?? '선택지 A',
        rightLabel: rightOption?.label ?? '선택지 B',
        leftPercent,
        rightPercent,
        gapPercent,
        previewTotalVotes,
      };
    });
  }, [scoreboardItems, scoreboardTopicSummaries, topicById]);
  const desktopColors = useMemo(
    () => {
      if (!isDarkTheme) {
        return {
          blue: '#2563eb',
          blueSoft: 'rgba(37,99,235,0.2)',
          red: '#ea580c',
          redSoft: 'rgba(234,88,12,0.18)',
          bg: '#edf2f8',
          surface: 'rgba(255,255,255,0.86)',
          surfaceAlt: 'rgba(255,255,255,0.74)',
          surfaceHover: 'rgba(15,23,42,0.08)',
          textPrimary: '#0f172a',
          textSecondary: 'rgba(15,23,42,0.72)',
          border: 'rgba(15,23,42,0.12)',
          divider: 'rgba(15,23,42,0.14)',
          buttonBg: 'rgba(15,23,42,0.08)',
          buttonHover: 'rgba(15,23,42,0.14)',
          mapOverlay:
            'linear-gradient(to_bottom, rgba(236,242,248,0.32), rgba(236,242,248,0.12) 38%, rgba(236,242,248,0.5))',
        };
      }

      return {
        blue: '#2f74ff',
        blueSoft: 'rgba(47,116,255,0.24)',
        red: '#ff6b00',
        redSoft: 'rgba(255,107,0,0.2)',
        bg: '#050a12',
        surface: 'rgba(20,20,24,0.82)',
        surfaceAlt: 'rgba(18,20,28,0.78)',
        surfaceHover: 'rgba(255,255,255,0.1)',
        textPrimary: '#ffffff',
        textSecondary: 'rgba(255,255,255,0.72)',
        border: 'rgba(255,255,255,0.12)',
        divider: 'rgba(255,255,255,0.14)',
        buttonBg: 'rgba(255,255,255,0.08)',
        buttonHover: 'rgba(255,255,255,0.14)',
        mapOverlay:
          'linear-gradient(to_bottom, rgba(4,10,18,0.55), rgba(4,10,18,0.18) 38%, rgba(4,10,18,0.74))',
      };
    },
    [isDarkTheme],
  );
  const mapTheme: 'dark' | 'light' = isDarkTheme ? 'dark' : 'light';
  const sharedGlobalMapProps = useMemo(
    () => ({
      country: selectedCountry,
      enableWorldNavigation: true,
      statsByCode: mergedMapStats,
      defaultRegionLevel: (isKoreaSelected ? 'l2' : 'l1') as CountryMapLevel,
      fillMode: 'activity' as const,
      height: '100%' as const,
      bottomDockHeightPx: bottomDockHeight,
      toggleClearancePx: 18,
      theme: mapTheme,
      showTooltip: false,
      showNavigationControl: false,
      showRegionLevelToggle: true,
      regionLevelToggleAlign: 'right' as const,
      colors: MAIN_MAP_COLORS,
      onRegionClick: (region: { code: string; name: string; level: CountryMapLevel; stat?: RegionVoteMap[string] }) => {
        setSelectedRegion((prev) =>
          prev && prev.code === region.code && prev.level === region.level ? null : region,
        );
      },
      onActiveCountryChange: (nextCountry: SupportedCountry) => {
        if (nextCountry !== viewerSupportedCountry) {
          manualCountrySelectionRef.current = true;
        }
        setSelectedCountry((prev) => (prev === nextCountry ? prev : nextCountry));
      },
      countryFocusOffsetPx: [
        isDesktopViewport && isDesktopLeftPanelOpen ? DESKTOP_LEFT_PANEL_MAP_FOCUS_OFFSET_X : 0,
        0,
      ] as [number, number],
    }),
    [
      bottomDockHeight,
      isDesktopLeftPanelOpen,
      isDesktopViewport,
      isKoreaSelected,
      mapTheme,
      mergedMapStats,
      selectedCountry,
      viewerSupportedCountry,
    ],
  );
  const ensureDesktopRegionHotTopics = useCallback((level: 'sido' | 'sigungu', code: string) => {
    if (!isKoreaSelected) {
      return;
    }

    const key = makeRegionCacheKey(level, code);
    if (desktopRegionHotTopicsCacheRef.current[key] || desktopRegionHotTopicsInFlightRef.current.has(key)) {
      return;
    }

    const abortController = new AbortController();
    desktopRegionHotTopicsInFlightRef.current.set(key, abortController);
    setDesktopRegionHotTopicsCache((prev) => ({
      ...prev,
      [key]: {
        status: 'loading',
        topics: [],
        error: null,
      },
    }));

    void (async () => {
      try {
        const query = new URLSearchParams({
          level,
          code,
          limit: '3',
          country: selectedCountry,
        });
        const response = await fetch(`/api/votes/top-topics-by-region?${query.toString()}`, {
          cache: 'no-store',
          signal: abortController.signal,
        });
        const json = (await response.json()) as RegionHotTopicsResponse;

        if (!response.ok) {
          setDesktopRegionHotTopicsCache((prev) => ({
            ...prev,
            [key]: {
              status: 'error',
              topics: [],
              error: json.error ?? '지역 인기 주제를 불러오지 못했습니다.',
            },
          }));
          return;
        }

        setDesktopRegionHotTopicsCache((prev) => ({
          ...prev,
          [key]: {
            status: 'success',
            topics: Array.isArray(json.topics) ? json.topics : [],
            error: null,
          },
        }));
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }
        setDesktopRegionHotTopicsCache((prev) => ({
          ...prev,
          [key]: {
            status: 'error',
            topics: [],
            error: error instanceof Error ? error.message : '지역 인기 주제를 불러오지 못했습니다.',
          },
        }));
      } finally {
        const inflight = desktopRegionHotTopicsInFlightRef.current.get(key);
        if (inflight === abortController) {
          desktopRegionHotTopicsInFlightRef.current.delete(key);
        }
      }
    })();
  }, [isKoreaSelected, selectedCountry]);
  const renderDesktopRegionTooltip = useCallback(
    (context: BaseCountryTooltipContext) => {
      const apiLevel = toKoreaRegionApiLevel(context.level);
      const key = apiLevel ? makeRegionCacheKey(apiLevel, context.code) : null;
      const cacheEntry = key ? desktopRegionHotTopicsCache[key] : null;
      const totalVotes = context.stat?.total ?? 0;
      const gapPercent = typeof context.stat?.gapPercent === 'number' ? Math.max(0, Math.round(context.stat.gapPercent)) : 0;
      const isLoading = Boolean(apiLevel) && (!cacheEntry || cacheEntry.status === 'loading');

      return (
        <div className="w-[min(360px,calc(100vw-48px))] rounded-[20px] border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3.5 shadow-[var(--app-card-shadow)] backdrop-blur-2xl">
          <div className="flex items-center justify-between">
            <h4 className="truncate text-[15px] font-semibold text-[color:var(--app-text-primary)]">{context.name || context.code}</h4>
            <span className="rounded-full border border-[color:var(--app-border)] bg-[color:var(--app-surface-soft)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--app-text-muted)]">
              {formatRegionLevelLabel(context.level)}
            </span>
          </div>

          <p className="mt-2 text-[12px] text-[color:var(--app-text-secondary)]">
            현재 격차 <span className="font-semibold text-[color:var(--app-text-primary)]">{gapPercent}%p</span> · 총{' '}
            <span className="font-semibold text-[color:var(--app-text-primary)]">{totalVotes.toLocaleString()}표</span>
          </p>

          <div className="mt-2.5 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface-soft)] px-3 py-2.5">
            <p className="text-[12px] font-semibold text-[color:var(--app-text-primary)]">이 지역에서 가장 활발한 주제 TOP 3</p>

            {!apiLevel ? (
              <p className="mt-2 text-[12px] text-[color:var(--app-text-muted)]">이 레벨에서는 KR 인기 주제 프리뷰를 제공하지 않습니다.</p>
            ) : isLoading ? (
              <div className="mt-2.5 space-y-2">
                <div className="h-9 animate-pulse rounded-lg bg-[color:var(--app-surface-soft-strong)]" />
                <div className="h-9 animate-pulse rounded-lg bg-[color:var(--app-surface-soft-strong)]" />
                <div className="h-9 animate-pulse rounded-lg bg-[color:var(--app-surface-soft-strong)]" />
              </div>
            ) : cacheEntry && cacheEntry.status === 'success' && cacheEntry.topics.length > 0 ? (
              <div className="mt-2 space-y-1.5">
                {cacheEntry.topics.map((topic, index) => (
                  <button
                    key={topic.topicId}
                    type="button"
                    onClick={() => pushResultPage(topic.topicId)}
                    className="inline-flex h-11 w-full cursor-pointer items-center justify-between rounded-lg border border-[color:var(--app-border)] bg-[color:var(--app-surface-soft)] px-2.5 text-left transition hover:bg-[color:var(--app-surface-soft-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f0a]/55"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[color:var(--app-border)] bg-[color:var(--app-surface-soft-strong)] text-[11px] font-bold text-[color:var(--app-text-primary)]">
                        {index + 1}
                      </span>
                      <span className="truncate text-[12px] font-medium text-[color:var(--app-text-primary)]">{topic.title}</span>
                    </div>
                    <span className="ml-2 shrink-0 text-[11px] font-semibold text-[#8fb8ff]">
                      {topic.voteCount.toLocaleString()}표
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[12px] text-[color:var(--app-text-muted)]">
                {cacheEntry?.error ?? '이 지역의 인기 주제 데이터가 아직 충분하지 않습니다.'}
              </p>
            )}
          </div>
        </div>
      );
    },
    [desktopRegionHotTopicsCache, pushResultPage],
  );
  const ageDistributionRows = useMemo(() => {
    if (!homeAnalytics) {
      return [] as Array<{ label: string; count: number; percent: number }>;
    }

    return [
      { label: '10대', count: homeAnalytics.age.buckets.teens.count, percent: homeAnalytics.age.buckets.teens.percent },
      {
        label: '20대',
        count: homeAnalytics.age.buckets.twenties.count,
        percent: homeAnalytics.age.buckets.twenties.percent,
      },
      {
        label: '30대',
        count: homeAnalytics.age.buckets.thirties.count,
        percent: homeAnalytics.age.buckets.thirties.percent,
      },
      {
        label: '40대',
        count: homeAnalytics.age.buckets.forties.count,
        percent: homeAnalytics.age.buckets.forties.percent,
      },
      {
        label: '50대+',
        count: homeAnalytics.age.buckets.fiftiesPlus.count,
        percent: homeAnalytics.age.buckets.fiftiesPlus.percent,
      },
    ];
  }, [homeAnalytics]);
  const isSchoolListVisible =
    canSelectSchoolInModal &&
    Boolean(schoolQuery.trim() && (!selectedSchool || schoolQuery !== selectedSchool.schoolName));
  const hasPendingRegionInput = Boolean(
    (canSelectSchoolInModal && selectedSchool) || (canUseGpsForViewer && gpsRegionInput),
  );
  const hintReservePaddingPx = useMemo(() => {
    if (isTopicPickerOpen) {
      return 0;
    }
    return topicHintHeight > 0 ? topicHintHeight + 8 : 0;
  }, [isTopicPickerOpen, topicHintHeight]);
  const topicListBottomInset = useMemo(() => 'calc(env(safe-area-inset-bottom) + 8px)', []);
  const mobileOverlayPaddingBottom = useMemo(
    () => `calc(9.2rem + env(safe-area-inset-bottom) + ${hintReservePaddingPx}px)`,
    [hintReservePaddingPx],
  );
  const emptySummary = useMemo(
    () =>
      normalizeSummary({
        totalVotes: 0,
        gapPercent: 0,
      }, 'locked'),
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
    if (!expandedHotTopicId) {
      return;
    }
    const stillVisible = popularTopics.some((topic) => topic.topicId === expandedHotTopicId);
    if (!stillVisible) {
      setExpandedHotTopicId(null);
      setHotTopicVoteMessage(null);
    }
  }, [expandedHotTopicId, popularTopics]);

  useEffect(() => {
    const topicIds = Array.from(new Set([
      ...popularTopics.map((topic) => topic.topicId),
      ...availableTopics.map((topic) => topic.id),
    ]));
    if (topicIds.length === 0) {
      setHotTopicViewerById({});
      return;
    }

    let cancelled = false;

    const run = async () => {
      if (!isAuthenticated && !guestSessionId) {
        const pendingVotes = new Set(readPendingVotes());
        const fallbackState = topicIds.reduce<Record<string, TopicVoteViewerState>>((acc, topicId) => {
          acc[topicId] = buildFallbackViewerState(pendingVotes.has(topicId));
          return acc;
        }, {});
        if (!cancelled) {
          setHotTopicViewerById(fallbackState);
        }
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

      const headers = buildVoteRequestHeaders(
        accessToken,
        isAuthenticated ? null : guestSessionId,
      );
      const resultRows = await Promise.all(
        topicIds.map(async (topicId) => {
          try {
            const query = new URLSearchParams({ topicId, country: selectedCountry });
            const response = await fetch(`/api/votes/result-summary?${query.toString()}`, {
              cache: 'no-store',
              headers,
            });
            if (!response.ok) {
              return [topicId, buildFallbackViewerState(false)] as const;
            }
            const json = (await response.json()) as FeaturedResultSummaryResponse;
            return [topicId, normalizeViewerState(json)] as const;
          } catch {
            return [topicId, buildFallbackViewerState(false)] as const;
          }
        }),
      );

      if (cancelled) {
        return;
      }

      const nextState = resultRows.reduce<Record<string, TopicVoteViewerState>>((acc, [topicId, viewerState]) => {
        acc[topicId] = viewerState;
        return acc;
      }, {});
      setHotTopicViewerById(nextState);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    availableTopics,
    buildFallbackViewerState,
    guestSessionId,
    isAuthenticated,
    normalizeViewerState,
    popularTopics,
    selectedCountry,
  ]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setIsTopicsLoading(true);
      setTopicsError(null);
      setAvailableTopics([]);
      try {
        const query = new URLSearchParams({
          status: 'LIVE',
        });
        const response = await fetch(`/api/votes/topics?${query.toString()}`, { cache: 'no-store' });
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
      setIsHomeAnalyticsLoading(true);
      setHomeAnalyticsError(null);
      setHomeAnalytics(null);
      try {
        const query = new URLSearchParams({
          status: 'LIVE',
          country: selectedCountry,
        });
        const response = await fetch(`/api/votes/home-analytics?${query.toString()}`, { cache: 'no-store' });
        const json = (await response.json()) as HomeAnalyticsApiResponse;
        if (!response.ok) {
          if (!cancelled) {
            setHomeAnalytics(null);
            setHomeAnalyticsError(json.error ?? '홈 분석 데이터를 불러오지 못했습니다.');
          }
          return;
        }
        if (!cancelled) {
          setHomeAnalytics(json.demographics ?? null);
        }
      } catch {
        if (!cancelled) {
          setHomeAnalytics(null);
          setHomeAnalyticsError('홈 분석 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) {
          setIsHomeAnalyticsLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [selectedCountry]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setIsScoreboardLoading(true);
      setScoreboardError(null);
      setScoreboardItems([]);
      setScoreboardTopicSummaries({});
      try {
        const query = new URLSearchParams({
          status: 'LIVE',
          minTotalVotes: '1',
          country: selectedCountry,
        });
        const response = await fetch(`/api/votes/scoreboard?${query.toString()}`, {
          cache: 'no-store',
        });
        const json = (await response.json()) as ScoreboardResponse;
        if (!response.ok) {
          if (!cancelled) {
            setScoreboardItems([]);
            setScoreboardError(json.error ?? '인기 투표를 불러오지 못했습니다.');
          }
          return;
        }

        if (!cancelled) {
          setScoreboardItems(Array.isArray(json.items) ? json.items : []);
        }
      } catch {
        if (!cancelled) {
          setScoreboardItems([]);
          setScoreboardError('인기 투표를 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) {
          setIsScoreboardLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [selectedCountry]);

  useEffect(() => {
    const targetIds = scoreboardItems.slice(0, 3).map((item) => item.topicId);
    if (targetIds.length === 0) {
      setScoreboardTopicSummaries({});
      return;
    }

    let cancelled = false;

    const run = async () => {
      let accessToken: string | null = null;
      if (isAuthenticated) {
        const supabase = getSupabaseBrowserClient();
        if (supabase) {
          const { data: sessionData } = await supabase.auth.getSession();
          accessToken = sessionData.session?.access_token ?? null;
        }
      }

      const headers = buildVoteRequestHeaders(
        accessToken,
        isAuthenticated ? null : guestSessionId,
      );
      const nonce = Date.now();
      const results = await Promise.all(
        targetIds.map(async (topicId) => {
          try {
            const query = new URLSearchParams({
              scope: 'topic',
              topicId,
              level: 'sido',
              country: selectedCountry,
              ts: String(nonce),
            });

            const response = await fetch(`/api/votes/region-stats?${query.toString()}`, { cache: 'no-store', headers });
            if (!response.ok) {
              return [topicId, normalizeSummary({ totalVotes: 0, gapPercent: 0 }, 'locked')] as const;
            }
            const json = (await response.json()) as RegionStatsSummaryResponse;
            const visibility = json.visibility ?? 'locked';
            return [topicId, normalizeSummary(json.summary ?? { totalVotes: 0, gapPercent: 0 }, visibility)] as const;
          } catch {
            return [topicId, normalizeSummary({ totalVotes: 0, gapPercent: 0 }, 'locked')] as const;
          }
        }),
      );

      if (cancelled) {
        return;
      }

      const next: Record<string, NormalizedVoteSummary> = {};
      results.forEach(([topicId, summary]) => {
        next[topicId] = summary;
      });
      setScoreboardTopicSummaries(next);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [guestSessionId, isAuthenticated, scoreboardItems, selectedCountry]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setIsFeaturedLoading(true);
      setFeaturedTopic(null);
      setFeaturedMetrics(null);
      try {
        const query = new URLSearchParams({
          status: 'LIVE',
          country: selectedCountry,
        });
        const response = await fetch(`/api/votes/featured?${query.toString()}`, { cache: 'no-store' });
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
  }, [selectedCountry]);

  const loadHomeMapStats = useCallback(async () => {
    try {
      const nonce = Date.now();
      const buildStatsUrl = (level: 'sido' | 'sigungu') => {
        const query = new URLSearchParams({
          scope: 'all',
          level,
          country: selectedCountry,
          ts: String(nonce),
        });
        return `/api/votes/region-stats?${query.toString()}`;
      };
      const [sidoRes, sigunguRes] = await Promise.allSettled([
        fetch(buildStatsUrl('sido'), {
          cache: 'no-store',
        }),
        fetch(buildStatsUrl('sigungu'), {
          cache: 'no-store',
        }),
      ]);

      let sidoJson: { statsByCode?: RegionVoteMap } | null = null;
      let sigunguJson: { statsByCode?: RegionVoteMap } | null = null;

      if (sidoRes.status === 'fulfilled' && sidoRes.value.ok) {
        sidoJson = (await sidoRes.value.json()) as { statsByCode?: RegionVoteMap };
      }
      if (sigunguRes.status === 'fulfilled' && sigunguRes.value.ok) {
        sigunguJson = (await sigunguRes.value.json()) as { statsByCode?: RegionVoteMap };
      }

      const nextMapStats: RegionVoteMap = {
        ...(sidoJson?.statsByCode ?? {}),
        ...(sigunguJson?.statsByCode ?? {}),
      };

      setMapStats(nextMapStats);
      writeCachedRegionState({
        cacheKey: homeMapCacheKey,
        statsByCode: nextMapStats,
      });
    } catch {
      // keep current map state on transient fetch failures
    }
  }, [homeMapCacheKey, selectedCountry]);

  const loadFeaturedSummary = useCallback(
    async (topicId: string) => {
      setIsStatsLoading(true);
      try {
        let accessToken: string | null = null;
        if (isAuthenticated) {
          const supabase = getSupabaseBrowserClient();
          if (supabase) {
            const { data: sessionData } = await supabase.auth.getSession();
            accessToken = sessionData.session?.access_token ?? null;
          }
        }

        const query = new URLSearchParams({
          scope: 'topic',
          topicId,
          level: 'sido',
          country: selectedCountry,
          ts: String(Date.now()),
        });

        const response = await fetch(`/api/votes/region-stats?${query.toString()}`, {
          cache: 'no-store',
          headers: buildVoteRequestHeaders(
            accessToken,
            isAuthenticated ? null : guestSessionId,
          ),
        });

        if (!response.ok) {
          setFeaturedResultVisibility('locked');
          setSummary(emptySummary);
          return;
        }

        const json = (await response.json()) as RegionStatsSummaryResponse;
        const visibility = json.visibility ?? 'locked';
        setFeaturedResultVisibility(visibility);

        if (json.summary) {
          setSummary(normalizeSummary(json.summary, visibility));
        } else {
          setSummary(normalizeSummary({ totalVotes: 0, gapPercent: 0 }, visibility));
        }
      } catch {
        setFeaturedResultVisibility('locked');
        setSummary(emptySummary);
      } finally {
        setIsStatsLoading(false);
      }
    },
    [emptySummary, guestSessionId, isAuthenticated, selectedCountry],
  );

  useEffect(() => {
    const cachedRegionState = readCachedRegionState(homeMapCacheKey);
    if (cachedRegionState) {
      setMapStats(cachedRegionState.statsByCode);
      return;
    }

    setMapStats({});
  }, [homeMapCacheKey]);

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
      setFeaturedResultVisibility('locked');
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
    const storedRegionInput = readPendingRegionInput();
    if (!storedRegionInput) {
      return;
    }

    if (isAuthenticated) {
      if (hasSavedSchool) {
        return;
      }
      if (!canUseGpsForViewer && storedRegionInput.source === 'gps') {
        clearPendingRegionInput();
        setGpsRegionInput(null);
        return;
      }
      if (storedRegionInput.source === 'gps') {
        setGpsRegionInput(storedRegionInput);
      }
      return;
    }

    if (storedRegionInput.source === 'school') {
      setSelectedSchool(storedRegionInput.school);
      setSchoolQuery(storedRegionInput.school.schoolName);
      setGpsRegionInput(null);
      return;
    }

    if (!canUseGpsForViewer) {
      clearPendingRegionInput();
      setGpsRegionInput(null);
      return;
    }

    setGpsRegionInput(storedRegionInput);
  }, [canUseGpsForViewer, hasSavedSchool, isAuthenticated]);

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
        setFeaturedVoteViewer(buildFallbackViewerState(false));
        setFeaturedResultVisibility('locked');
        return;
      }

      if (!isAuthenticated && !guestSessionId) {
        const fallbackViewerState = buildFallbackViewerState(guestHasVoted);
        setFeaturedVoteViewer(fallbackViewerState);
        setFeaturedResultVisibility(fallbackViewerState.hasVoteInScope ? 'unlocked' : 'locked');
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

        const query = new URLSearchParams({ topicId, country: selectedCountry });

        const response = await fetch(`/api/votes/result-summary?${query.toString()}`, {
          cache: 'no-store',
          headers: buildVoteRequestHeaders(
            accessToken,
            isAuthenticated ? null : guestSessionId,
          ),
        });

        if (!response.ok) {
          if (!cancelled) {
            const fallbackViewerState = buildFallbackViewerState(!isAuthenticated && guestHasVoted);
            setFeaturedVoteViewer(fallbackViewerState);
            setFeaturedResultVisibility(fallbackViewerState.hasVoteInScope ? 'unlocked' : 'locked');
          }
          return;
        }

        const json = (await response.json()) as FeaturedResultSummaryResponse;
        if (cancelled) {
          return;
        }

        const viewerState = normalizeViewerState(json);
        setFeaturedVoteViewer(viewerState);
        setFeaturedResultVisibility(json.visibility ?? (viewerState.hasVoteInScope ? 'unlocked' : 'locked'));

        const votedOptionKey = json.myChoice?.optionKey ?? null;
        if (viewerState.hasVoteInScope && votedOptionKey) {
          setSelectedOption(votedOptionKey);
        }
      } catch {
        if (!cancelled) {
          const fallbackViewerState = buildFallbackViewerState(!isAuthenticated && guestHasVoted);
          setFeaturedVoteViewer(fallbackViewerState);
          setFeaturedResultVisibility(fallbackViewerState.hasVoteInScope ? 'unlocked' : 'locked');
        }
      }
    };

    void syncFeaturedVoteState();

    return () => {
      cancelled = true;
    };
  }, [
    buildFallbackViewerState,
    featuredTopic?.id,
    guestHasVoted,
    guestSessionId,
    isAuthenticated,
    normalizeViewerState,
    selectedCountry,
  ]);

  const canOpenFeaturedResult = useMemo(() => {
    if (!featuredTopic?.id) {
      return false;
    }
    return featuredVoteViewer.hasTopicVote;
  }, [featuredTopic?.id, featuredVoteViewer.hasTopicVote]);

  useEffect(() => {
    if (!isKoreaSelected || !isDesktopViewport || !desktopTooltipRegion) {
      return;
    }

    const apiLevel = toKoreaRegionApiLevel(desktopTooltipRegion.level);
    if (!apiLevel) {
      return;
    }
    ensureDesktopRegionHotTopics(apiLevel, desktopTooltipRegion.code);
  }, [desktopTooltipRegion, ensureDesktopRegionHotTopics, isDesktopViewport, isKoreaSelected]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!isKoreaSelected) {
        setRegionHotTopics([]);
        setRegionHotTopicsError(null);
        setIsRegionHotTopicsLoading(false);
        return;
      }

      if (!selectedRegion) {
        setRegionHotTopics([]);
        setRegionHotTopicsError(null);
        setIsRegionHotTopicsLoading(false);
        return;
      }

      const apiLevel = toKoreaRegionApiLevel(selectedRegion.level);
      if (!apiLevel) {
        setRegionHotTopics([]);
        setRegionHotTopicsError('해당 레벨은 인기 주제 집계를 지원하지 않습니다.');
        setIsRegionHotTopicsLoading(false);
        return;
      }

      setIsRegionHotTopicsLoading(true);
      setRegionHotTopicsError(null);
      try {
        const query = new URLSearchParams({
          level: apiLevel,
          code: selectedRegion.code,
          limit: '3',
          country: selectedCountry,
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
  }, [isKoreaSelected, selectedCountry, selectedRegion]);

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
    if (!showProfileModal || !canSelectSchoolInModal) {
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
  }, [canSelectSchoolInModal, schoolQuery, showProfileModal]);

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

  const handleSelectSchool = useCallback(
    (school: SchoolSearchItem) => {
      if (!canSelectSchoolInModal) {
        return;
      }
      setSelectedSchool(school);
      setSchoolQuery(school.schoolName);
      setHighlightedSchoolIndex(0);
      setGpsRegionInput(null);
      setProfileModalMessage(null);
    },
    [canSelectSchoolInModal],
  );

  const buildPendingRegionInput = useCallback((): VoteRegionInput | null => {
    if (isAuthenticated && hasSavedSchool) {
      return null;
    }

    if (canSelectSchoolInModal && selectedSchool) {
      const payload: VoteRegionInput = {
        source: 'school',
        school: selectedSchool,
      };
      writePendingRegionInput(payload);
      return payload;
    }

    if (canUseGpsForViewer && gpsRegionInput) {
      writePendingRegionInput(gpsRegionInput);
      return gpsRegionInput;
    }

    return null;
  }, [canSelectSchoolInModal, canUseGpsForViewer, gpsRegionInput, hasSavedSchool, isAuthenticated, selectedSchool]);

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
    if (!canUseGpsForViewer) {
      setProfileModalMessage('국내 사용자의 GPS 위치 기능은 출시 예정입니다.');
      return;
    }

    setIsLocatingRegion(true);
    setProfileModalMessage(null);

    try {
      const nextGpsRegionInput = await resolveVoteRegionInputFromCurrentLocation(viewerSupportedCountry);
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
  }, [canUseGpsForViewer, viewerSupportedCountry]);

  const handleClearGpsRegion = useCallback(() => {
    setGpsRegionInput(null);
    setProfileModalMessage(null);
  }, []);

  const submitVote = useCallback(
    async (regionInputPayload: VoteRegionInput | null) => {
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
            countryCode: viewerSupportedCountry,
            scopeCountryCode: selectedCountry,
            guestSessionId: isAuthenticated ? undefined : guestSessionId,
            ...(regionInputPayload ? { regionInput: regionInputPayload } : {}),
          }),
        });

        const json = (await response.json()) as {
          error?: string;
          voteCountryCode?: string;
          isCrossCountryVote?: boolean;
        };
        if (!response.ok) {
          if (response.status === 409) {
            setVoteMessage('이미 해당 주제에 투표했습니다.');
            if (!isAuthenticated) {
              setGuestHasVoted(true);
            }
            const existingVoteCountryCode = featuredVoteViewer.voteCountryCode ?? viewerSupportedCountry;
            setFeaturedVoteViewer({
              ...buildFallbackViewerState(true),
              voteCountryCode: existingVoteCountryCode,
              hasVoteInScope: existingVoteCountryCode === selectedCountry,
            });
            setFeaturedResultVisibility(existingVoteCountryCode === selectedCountry ? 'unlocked' : 'locked');
            if (selectedCountry !== existingVoteCountryCode) {
              openResultScopeChooser(topicId, featuredTopic?.title ?? '결과 보기', existingVoteCountryCode);
            } else {
              pushResultPage(topicId);
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

        const voteCountryCode = json.voteCountryCode ? resolveSupportedCountry(json.voteCountryCode) : viewerSupportedCountry;
        const shouldOptimisticallyUpdateCurrentScope = selectedCountry === voteCountryCode;
        setFeaturedVoteViewer({
          ...buildFallbackViewerState(true),
          voteCountryCode,
          hasVoteInScope: shouldOptimisticallyUpdateCurrentScope,
        });

        const optimisticRegion = resolveOptimisticRegionCodes(regionInputPayload);
        const optimisticSidoCode = optimisticRegion.sidoCode;
        const optimisticSigunguCode = optimisticRegion.sigunguCode;

        if (shouldOptimisticallyUpdateCurrentScope && (optimisticSidoCode || optimisticSigunguCode)) {
          let optimisticMap = mapStats;
          if (optimisticSidoCode) {
            optimisticMap = bumpRegionStat(optimisticMap, optimisticSidoCode, optionKey, optionAKey, optionBKey);
          }
          if (optimisticSigunguCode) {
            optimisticMap = bumpRegionStat(optimisticMap, optimisticSigunguCode, optionKey, optionAKey, optionBKey);
          }

          writeCachedRegionState({
            cacheKey: homeMapCacheKey,
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
            }, 'unlocked'),
          );
        }

        setFeaturedResultVisibility(shouldOptimisticallyUpdateCurrentScope ? 'unlocked' : 'locked');
        setVoteMessage(
          shouldOptimisticallyUpdateCurrentScope
            ? '투표가 반영되었습니다.'
            : `${viewerSupportedCountry} 기준으로 투표가 반영되었습니다.`,
        );
        if (selectedCountry !== voteCountryCode || json.isCrossCountryVote) {
          openResultScopeChooser(topicId, featuredTopic?.title ?? '결과 보기', voteCountryCode);
        } else {
          pushResultPage(topicId);
        }
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
      homeMapCacheKey,
      isAuthenticated,
      mapStats,
      openResultScopeChooser,
      featuredTopic?.title,
      featuredVoteViewer.voteCountryCode,
      buildFallbackViewerState,
      pushResultPage,
      resolveOptimisticRegionCodes,
      selectedOption,
      selectedCountry,
      viewerSupportedCountry,
    ],
  );

  const handleVote = useCallback(async () => {
    if (canOpenFeaturedResult && featuredTopic?.id) {
      if (selectedCountry !== viewerSupportedCountry) {
        openResultScopeChooser(featuredTopic.id, featuredTopic.title, featuredVoteViewer.voteCountryCode);
      } else {
        pushResultPage(featuredTopic.id);
      }
      setIsVoteCardCollapsed(false);
      return;
    }

    if (isAuthenticated && requiresSignupCompletion) {
      setVoteMessage(SIGNUP_COMPLETION_REQUIRED_MESSAGE);
      router.push('/auth/complete-signup');
      return;
    }

    if (isAuthenticated && !hasSavedSchool && !canUseGpsForViewer) {
      setVoteMessage(KR_SCHOOL_REQUIRED_FOR_MEMBER_MESSAGE);
      router.push('/my/edit');
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

    const payload = buildPendingRegionInput();
    if (payload) {
      await submitVote(payload);
      return;
    }

    if (canSkipLocationPrompt) {
      await submitVote(null);
      return;
    }

    setProfileModalMessage(null);
    setVoteAfterProfile(true);
    setShowProfileModal(true);
  }, [
    canOpenFeaturedResult,
    buildPendingRegionInput,
    featuredOptionAKey,
    featuredOptionBKey,
    featuredTopic,
    canSkipLocationPrompt,
    canUseGpsForViewer,
    featuredVoteViewer.voteCountryCode,
    hasSavedSchool,
    isAuthenticated,
    openResultScopeChooser,
    pushResultPage,
    requiresSignupCompletion,
    router,
    selectedCountry,
    selectedOption,
    submitVote,
    viewerSupportedCountry,
  ]);

  const submitTopicPickerVote = useCallback(
    async (targetVote: PendingTopicPickerVote, regionInputPayload: VoteRegionInput | null) => {
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
            countryCode: viewerSupportedCountry,
            scopeCountryCode: selectedCountry,
            guestSessionId: isAuthenticated ? undefined : guestSessionId,
            ...(regionInputPayload ? { regionInput: regionInputPayload } : {}),
          }),
        });

        const json = (await response.json()) as {
          error?: string;
          voteCountryCode?: string;
          isCrossCountryVote?: boolean;
        };
        if (!response.ok) {
          if (response.status === 409) {
            setPickerVoteMessage('이미 투표한 주제입니다. 결과 페이지로 이동합니다.');
            if (!isAuthenticated) {
              setGuestHasVoted(true);
            }
            const existingVoteCountryCode =
              hotTopicViewerById[topicId]?.voteCountryCode ?? viewerSupportedCountry;
            setHotTopicViewerById((prev) => ({
              ...prev,
              [topicId]: {
                ...buildFallbackViewerState(true),
                voteCountryCode: existingVoteCountryCode,
                hasVoteInScope: existingVoteCountryCode === selectedCountry,
              },
            }));
            setIsTopicPickerOpen(false);
            if (selectedCountry !== existingVoteCountryCode) {
              openResultScopeChooser(topicId, topicById.get(topicId)?.title ?? '결과 보기', existingVoteCountryCode);
            } else {
              pushResultPage(topicId);
            }
            return;
          }
          setPickerVoteMessage(json.error ?? '투표 처리 중 오류가 발생했습니다.');
          return;
        }

        if (!isAuthenticated) {
          addPendingVoteTopic(topicId);
          setGuestHasVoted(true);
        }

        const voteCountryCode = json.voteCountryCode ? resolveSupportedCountry(json.voteCountryCode) : viewerSupportedCountry;
        const shouldOptimisticallyUpdateCurrentScope = selectedCountry === voteCountryCode;
        setHotTopicViewerById((prev) => ({
          ...prev,
          [topicId]: {
            ...buildFallbackViewerState(true),
            voteCountryCode,
            hasVoteInScope: shouldOptimisticallyUpdateCurrentScope,
          },
        }));

        const optimisticRegion = resolveOptimisticRegionCodes(regionInputPayload);
        const optimisticSidoCode = optimisticRegion.sidoCode;
        const optimisticSigunguCode = optimisticRegion.sigunguCode;

        if (shouldOptimisticallyUpdateCurrentScope && (optimisticSidoCode || optimisticSigunguCode)) {
          let optimisticMap = mapStats;
          if (optimisticSidoCode) {
            optimisticMap = bumpRegionStat(optimisticMap, optimisticSidoCode, optionKey, optionAKey, optionBKey);
          }
          if (optimisticSigunguCode) {
            optimisticMap = bumpRegionStat(optimisticMap, optimisticSigunguCode, optionKey, optionAKey, optionBKey);
          }

          writeCachedRegionState({
            cacheKey: homeMapCacheKey,
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
              }, 'unlocked'),
            );
            setFeaturedResultVisibility('unlocked');
          }
        }

        if (featuredTopic?.id === topicId) {
          setFeaturedVoteViewer({
            ...buildFallbackViewerState(true),
            voteCountryCode,
            hasVoteInScope: shouldOptimisticallyUpdateCurrentScope,
          });
          setFeaturedResultVisibility(shouldOptimisticallyUpdateCurrentScope ? 'unlocked' : 'locked');
        }

        setPickerVoteMessage(
          shouldOptimisticallyUpdateCurrentScope
            ? '투표가 반영되었습니다. 결과 페이지로 이동합니다.'
            : `${viewerSupportedCountry} 기준으로 투표가 반영되었습니다.`,
        );
        setIsTopicPickerOpen(false);
        if (selectedCountry !== voteCountryCode || json.isCrossCountryVote) {
          openResultScopeChooser(topicId, topicById.get(topicId)?.title ?? '결과 보기', voteCountryCode);
        } else {
          pushResultPage(topicId);
        }
      } catch {
        setPickerVoteMessage('투표 처리 중 오류가 발생했습니다.');
      } finally {
        setIsPickerSubmittingVote(false);
      }
    },
    [
      guestSessionId,
      homeMapCacheKey,
      isAuthenticated,
      mapStats,
      hotTopicViewerById,
      buildFallbackViewerState,
      featuredTopic,
      openResultScopeChooser,
      pushResultPage,
      resolveOptimisticRegionCodes,
      selectedCountry,
      topicById,
      viewerSupportedCountry,
    ],
  );

  const handleTopicPickerVoteSubmit = useCallback(
    async (topic: VoteTopic) => {
      const topicViewer = hotTopicViewerById[topic.id];
      if (topicViewer?.hasTopicVote) {
        if ((topicViewer.voteCountryCode ?? viewerSupportedCountry) !== selectedCountry) {
          openResultScopeChooser(topic.id, topic.title, topicViewer.voteCountryCode ?? viewerSupportedCountry);
        } else {
          pushResultPage(topic.id);
        }
        return;
      }

      if (isAuthenticated && requiresSignupCompletion) {
        setPickerVoteMessage(SIGNUP_COMPLETION_REQUIRED_MESSAGE);
        router.push('/auth/complete-signup');
        return;
      }

      if (isAuthenticated && !hasSavedSchool && !canUseGpsForViewer) {
        setPickerVoteMessage(KR_SCHOOL_REQUIRED_FOR_MEMBER_MESSAGE);
        router.push('/my/edit');
        return;
      }

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

      const payload = buildPendingRegionInput();
      if (payload) {
        await submitTopicPickerVote(targetVote, payload);
        return;
      }

      if (canSkipLocationPrompt) {
        await submitTopicPickerVote(targetVote, null);
        return;
      }

      setPendingPickerVote(targetVote);
      setProfileModalMessage(null);
      setVoteAfterProfile(false);
      setShowProfileModal(true);
    },
    [
      buildPendingRegionInput,
      canSkipLocationPrompt,
      canUseGpsForViewer,
      hasSavedSchool,
      hotTopicViewerById,
      isAuthenticated,
      openResultScopeChooser,
      pickerSelectedOptionKey,
      pushResultPage,
      requiresSignupCompletion,
      router,
      selectedCountry,
      submitTopicPickerVote,
      viewerSupportedCountry,
    ],
  );

  const handleTopicPickerClose = useCallback(() => {
    setIsTopicPickerOpen(false);
    setExpandedPickerTopicId(null);
    setPickerSelectedOptionKey(null);
    setPickerVoteMessage(null);
    setPendingPickerVote(null);
    setPendingHotTopicVote(null);
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

  const submitHotTopicVote = useCallback(
    async (targetVote: PendingTopicPickerVote, regionInputPayload: VoteRegionInput | null) => {
      const { topicId, optionKey, optionAKey, optionBKey } = targetVote;
      setIsHotTopicSubmittingVote(true);
      setHotTopicVoteMessage(null);
      try {
        if (!isAuthenticated && !guestSessionId) {
          setHotTopicVoteMessage('세션 연결 중입니다. 잠시 후 다시 시도해 주세요.');
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
            countryCode: viewerSupportedCountry,
            scopeCountryCode: selectedCountry,
            guestSessionId: isAuthenticated ? undefined : guestSessionId,
            ...(regionInputPayload ? { regionInput: regionInputPayload } : {}),
          }),
        });

        const json = (await response.json()) as {
          error?: string;
          voteCountryCode?: string;
          isCrossCountryVote?: boolean;
        };
        if (!response.ok) {
          if (response.status === 409) {
            setHotTopicVoteMessage('이미 투표한 주제입니다. 결과 페이지로 이동합니다.');
            if (!isAuthenticated) {
              setGuestHasVoted(true);
            }
            const existingVoteCountryCode =
              hotTopicViewerById[topicId]?.voteCountryCode ?? viewerSupportedCountry;
            setHotTopicViewerById((prev) => ({
              ...prev,
              [topicId]: {
                ...buildFallbackViewerState(true),
                voteCountryCode: existingVoteCountryCode,
                hasVoteInScope: existingVoteCountryCode === selectedCountry,
              },
            }));
            if (selectedCountry !== existingVoteCountryCode) {
              openResultScopeChooser(topicId, topicById.get(topicId)?.title ?? '결과 보기', existingVoteCountryCode);
            } else {
              pushResultPage(topicId);
            }
            return;
          }
          setHotTopicVoteMessage(json.error ?? '투표 처리 중 오류가 발생했습니다.');
          return;
        }

        if (!isAuthenticated) {
          addPendingVoteTopic(topicId);
          setGuestHasVoted(true);
        }

        const voteCountryCode = json.voteCountryCode ? resolveSupportedCountry(json.voteCountryCode) : viewerSupportedCountry;
        const shouldOptimisticallyUpdateCurrentScope = selectedCountry === voteCountryCode;
        setHotTopicViewerById((prev) => ({
          ...prev,
          [topicId]: {
            ...buildFallbackViewerState(true),
            voteCountryCode,
            hasVoteInScope: shouldOptimisticallyUpdateCurrentScope,
          },
        }));

        const optimisticRegion = resolveOptimisticRegionCodes(regionInputPayload);
        const optimisticSidoCode = optimisticRegion.sidoCode;
        const optimisticSigunguCode = optimisticRegion.sigunguCode;

        if (shouldOptimisticallyUpdateCurrentScope && (optimisticSidoCode || optimisticSigunguCode)) {
          let optimisticMap = mapStats;
          if (optimisticSidoCode) {
            optimisticMap = bumpRegionStat(optimisticMap, optimisticSidoCode, optionKey, optionAKey, optionBKey);
          }
          if (optimisticSigunguCode) {
            optimisticMap = bumpRegionStat(optimisticMap, optimisticSigunguCode, optionKey, optionAKey, optionBKey);
          }

          writeCachedRegionState({
            cacheKey: homeMapCacheKey,
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
              }, 'unlocked'),
            );
            setFeaturedVoteViewer({
              ...buildFallbackViewerState(true),
              voteCountryCode,
              hasVoteInScope: shouldOptimisticallyUpdateCurrentScope,
            });
            setFeaturedResultVisibility(shouldOptimisticallyUpdateCurrentScope ? 'unlocked' : 'locked');
          }
        }

        setExpandedHotTopicId(null);
        setHotTopicVoteMessage(
          shouldOptimisticallyUpdateCurrentScope
            ? '투표가 반영되었습니다. 결과 페이지로 이동합니다.'
            : `${viewerSupportedCountry} 기준으로 투표가 반영되었습니다.`,
        );
        if (selectedCountry !== voteCountryCode || json.isCrossCountryVote) {
          openResultScopeChooser(topicId, topicById.get(topicId)?.title ?? '결과 보기', voteCountryCode);
        } else {
          pushResultPage(topicId);
        }
      } catch {
        setHotTopicVoteMessage('투표 처리 중 오류가 발생했습니다.');
      } finally {
        setIsHotTopicSubmittingVote(false);
      }
    },
    [
      featuredTopic?.id,
      guestSessionId,
      homeMapCacheKey,
      isAuthenticated,
      mapStats,
      hotTopicViewerById,
      buildFallbackViewerState,
      openResultScopeChooser,
      pushResultPage,
      resolveOptimisticRegionCodes,
      selectedCountry,
      topicById,
      viewerSupportedCountry,
    ],
  );

  const handleSaveRegionOnly = useCallback(async () => {
    const payload = buildPendingRegionInput();
    if (!payload) {
      if (pendingPickerVote) {
        setPickerVoteMessage(regionModalHintText);
      } else if (pendingHotTopicVote) {
        setHotTopicVoteMessage(regionModalHintText);
      } else {
        setVoteMessage(regionModalHintText);
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

    if (pendingHotTopicVote) {
      const pendingVote = pendingHotTopicVote;
      setPendingHotTopicVote(null);
      await submitHotTopicVote(pendingVote, payload);
      return;
    }

    if (voteAfterProfile) {
      setVoteAfterProfile(false);
      await submitVote(payload);
    } else {
      setVoteMessage('지역 정보가 저장되었습니다.');
    }
  }, [
    buildPendingRegionInput,
    pendingPickerVote,
    pendingHotTopicVote,
    regionModalHintText,
    submitHotTopicVote,
    submitTopicPickerVote,
    submitVote,
    voteAfterProfile,
  ]);

  const handleHotTopicImmediateVote = useCallback(
    async (targetVote: PendingTopicPickerVote) => {
      const topicViewer = hotTopicViewerById[targetVote.topicId];
      if (topicViewer?.hasTopicVote) {
        if ((topicViewer.voteCountryCode ?? viewerSupportedCountry) !== selectedCountry) {
          openResultScopeChooser(
            targetVote.topicId,
            topicById.get(targetVote.topicId)?.title ?? '결과 보기',
            topicViewer.voteCountryCode ?? viewerSupportedCountry,
          );
        } else {
          pushResultPage(targetVote.topicId);
        }
        return;
      }

      if (isAuthenticated && requiresSignupCompletion) {
        setHotTopicVoteMessage(SIGNUP_COMPLETION_REQUIRED_MESSAGE);
        router.push('/auth/complete-signup');
        return;
      }

      if (isAuthenticated && !hasSavedSchool && !canUseGpsForViewer) {
        setHotTopicVoteMessage(KR_SCHOOL_REQUIRED_FOR_MEMBER_MESSAGE);
        router.push('/my/edit');
        return;
      }

      const payload = buildPendingRegionInput();
      if (payload) {
        await submitHotTopicVote(targetVote, payload);
        return;
      }

      if (canSkipLocationPrompt) {
        await submitHotTopicVote(targetVote, null);
        return;
      }

      setPendingHotTopicVote(targetVote);
      setProfileModalMessage(null);
      setVoteAfterProfile(false);
      setShowProfileModal(true);
    },
    [
      buildPendingRegionInput,
      canSkipLocationPrompt,
      canUseGpsForViewer,
      hasSavedSchool,
      hotTopicViewerById,
      isAuthenticated,
      openResultScopeChooser,
      pushResultPage,
      requiresSignupCompletion,
      router,
      selectedCountry,
      submitHotTopicVote,
      topicById,
      viewerSupportedCountry,
    ],
  );

  const handleDesktopHotTopicToggle = useCallback((topicId: string) => {
    setHotTopicVoteMessage(null);
    setExpandedHotTopicId((prev) => {
      if (prev === topicId) {
        return null;
      }
      return topicId;
    });
  }, []);

  const handleBottomTabClick = useCallback(
    (tab: 'home' | 'map' | 'game' | 'me') => {
      if (tab === 'map') {
        setActiveTab('map');
        setIsTopicPickerOpen(true);
        setExpandedPickerTopicId(null);
        setPickerSelectedOptionKey(null);
        setPickerVoteMessage(null);
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
      setIsTopicPickerOpen(false);
      setActiveTab(tab);
    },
    [router],
  );

  const handleMapLayoutFullscreenToggle = useCallback(() => {
    setIsMapLayoutFullscreen((prev) => !prev);
  }, []);

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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(min-width: 768px)');
    setIsDesktopViewport(mediaQuery.matches);

    const handleViewportChange = (event: MediaQueryListEvent) => {
      setIsDesktopViewport(event.matches);
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleViewportChange);
      return () => mediaQuery.removeEventListener('change', handleViewportChange);
    }

    mediaQuery.addListener(handleViewportChange);
    return () => mediaQuery.removeListener(handleViewportChange);
  }, []);

  useEffect(() => {
    if (isDesktopViewport) {
      setSelectedRegion(null);
      return;
    }
    setDesktopTooltipRegion(null);
  }, [isDesktopViewport]);

  useEffect(() => {
    setSelectedRegion(null);
    setDesktopTooltipRegion(null);
    setVoteMessage(null);
    setHotTopicVoteMessage(null);
    setPickerVoteMessage(null);
    setFeaturedVoteViewer(buildFallbackViewerState(false));
    setGuestHasVoted(false);
    setHotTopicViewerById({});
    setExpandedHotTopicId(null);
    setExpandedPickerTopicId(null);
  }, [buildFallbackViewerState, selectedCountry]);

  return (
    <div
      className={isDesktopViewport ? '' : isDarkTheme ? 'bg-black text-white' : 'bg-[#edf2f8] text-[#0f172a]'}
      style={isDesktopViewport ? { backgroundColor: desktopColors.bg, color: desktopColors.textPrimary } : undefined}
    >
      <main className="relative h-screen w-full overflow-hidden [font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text','SF_Pro_Display','Segoe_UI',sans-serif]">
        <div className="absolute inset-0 z-0">
          {!isDesktopViewport ? (
            <>
              <div className="absolute inset-0">
                <BaseCountryAdminMap
                  {...sharedGlobalMapProps}
                  className="h-full w-full !rounded-none !border-0"
                />
              </div>

              <div
                className="pointer-events-none absolute inset-0"
                style={{ backgroundImage: desktopColors.mapOverlay }}
              />
              <div className="pointer-events-none absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 mix-blend-soft-light" />
            </>
          ) : null}
        </div>

        <div
          className="pointer-events-none relative z-20 mx-auto flex h-full w-full max-w-[1280px] flex-col px-4 pb-[var(--home-mobile-overlay-padding)] pt-[calc(0.5rem+env(safe-area-inset-top))] md:px-8 md:pb-6 md:pt-0 md:hidden"
          style={{ '--home-mobile-overlay-padding': mobileOverlayPaddingBottom } as CSSProperties}
        >
          <DesktopTopHeader
            className="pointer-events-auto"
            containerClassName="max-w-full px-0 sm:px-0 lg:px-0"
            links={[
              { key: 'home', label: '홈', active: activeTab === 'home', onClick: () => handleBottomTabClick('home') },
              { key: 'map', label: '지도', active: activeTab === 'map', onClick: () => handleBottomTabClick('map') },
              { key: 'game', label: '게임', active: activeTab === 'game', onClick: () => handleBottomTabClick('game') },
              { key: 'me', label: 'MY', active: activeTab === 'me', onClick: () => handleBottomTabClick('me') },
            ]}
            rightSlot={(
              <>
                <CountryTabs
                  selectedCountry={selectedCountry}
                  onSelectCountry={handleCountryTabSelect}
                  compact
                />
                <AccountMenuButton />
              </>
            )}
          />

          <div className="flex flex-col gap-3 md:mt-4 md:max-w-[500px] lg:max-w-[560px] lg:gap-4">
            {isVoteCardCollapsed ? (
              <button
                type="button"
                onClick={() => setIsVoteCardCollapsed(false)}
                aria-label="투표 섹션 열기"
                className="pointer-events-auto hidden lg:flex lg:min-h-[116px] lg:w-[68px] lg:flex-col lg:items-center lg:justify-center lg:gap-2 lg:rounded-2xl lg:border lg:border-[color:var(--app-border)] lg:bg-[color:var(--app-surface)] lg:text-[color:var(--app-text-secondary)] lg:shadow-[var(--app-card-shadow)] lg:transition-all lg:duration-200 lg:hover:border-[#ff9f0a]/45 lg:hover:bg-[color:var(--app-surface-strong)] lg:hover:text-[color:var(--app-text-primary)] lg:focus-visible:outline-none lg:focus-visible:ring-2 lg:focus-visible:ring-[#ff9f0a]/60"
              >
                <span className="text-center text-[12px] font-semibold leading-tight">
                  투표
                  <br />
                  열기
                </span>
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : null}

            <LiveVoteCard
              className={`shrink-0 ${isVoteCardCollapsed ? 'lg:hidden' : ''}`}
              topicId={featuredTopic?.id ?? null}
              title={featuredTopic?.title ?? '진행중인 주제를 준비 중입니다.'}
              variant="desktop_refined"
              resultVisibility={featuredResultVisibility}
              lockedGapPercent={summary.gapPercent}
              lockedTotalVotes={summary.totalVotes}
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
                    ? selectedCountry === viewerSupportedCountry
                      ? '이미 투표완료하셨습니다 · 결과보기'
                      : '이미 투표완료하셨습니다 · 결과 보기 선택'
                      : !selectedOption
                      ? '선택 후 투표하기'
                      : selectedCountry === viewerSupportedCountry
                        ? '투표 제출하기'
                        : '투표하기 · 내 국가 기준 반영'
              }
              message={voteMessage}
              isStatsLoading={isStatsLoading}
              totalVotes={summary.totalVotes}
              realtimeVotes={featuredMetrics?.realtimeVotes ?? null}
              leftOption={{
                key: featuredOptionAKey,
                label: featuredOptionALabel,
                percentage: featuredResultVisibility === 'unlocked' && summary.hasData ? summary.aPercent : null,
                subtext: getOptionSubtext(featuredTopic?.id, featuredOptionAKey),
              }}
              rightOption={{
                key: featuredOptionBKey,
                label: featuredOptionBLabel,
                percentage: featuredResultVisibility === 'unlocked' && summary.hasData ? summary.bPercent : null,
                subtext: getOptionSubtext(featuredTopic?.id, featuredOptionBKey),
              }}
            />

            {selectedRegion ? (
              <section
                ref={selectedRegionPanelRef}
                className={`pointer-events-auto shrink-0 rounded-[20px] border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3.5 shadow-[var(--app-card-shadow)] backdrop-blur-2xl lg:rounded-[24px] lg:p-4 lg:shadow-[var(--app-modal-shadow)] ${isVoteCardCollapsed ? 'lg:hidden' : ''
                  }`}
              >
                <div className="flex items-center justify-between">
                  <h4 className="truncate text-[15px] font-semibold text-[color:var(--app-text-primary)] lg:text-[17px]">
                    {selectedRegion.name || selectedRegion.code}
                  </h4>
                  <span className="rounded-full border border-[color:var(--app-border)] bg-[color:var(--app-surface-soft)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--app-text-muted)] lg:px-3 lg:text-xs">
                    {formatRegionLevelLabel(selectedRegion.level)}
                  </span>
                </div>

                <p className="mt-2 text-[12px] text-[color:var(--app-text-secondary)] lg:mt-2.5 lg:text-[13px]">
                  현재 격차{' '}
                  <span className="font-semibold text-[color:var(--app-text-primary)]">
                    {Math.max(0, Math.round(selectedRegionStat?.gapPercent ?? 0))}%p
                  </span>{' '}
                  · 총{' '}
                  <span className="font-semibold text-[color:var(--app-text-primary)]">
                    {((selectedRegionStat?.total ?? 0) || 0).toLocaleString()}표
                  </span>
                </p>

                <div className="mt-2.5 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface-soft)] px-3 py-2.5">
                  <p className="text-[12px] font-semibold text-[color:var(--app-text-primary)] lg:text-[13px]">
                    {isKoreaSelected ? '이 지역에서 가장 활발한 주제 TOP 3' : '이 지역의 핵심 지표'}
                  </p>

                  {isKoreaSelected && isRegionHotTopicsLoading ? (
                    <div className="mt-2.5 space-y-2">
                      <div className="h-9 animate-pulse rounded-lg bg-[color:var(--app-surface-soft-strong)]" />
                      <div className="h-9 animate-pulse rounded-lg bg-[color:var(--app-surface-soft-strong)]" />
                      <div className="h-9 animate-pulse rounded-lg bg-[color:var(--app-surface-soft-strong)]" />
                    </div>
                  ) : isKoreaSelected && regionHotTopics.length > 0 ? (
                    <div className="mt-2 space-y-1.5">
                      {regionHotTopics.map((topic, index) => (
                        <button
                          key={topic.topicId}
                          type="button"
                    onClick={() => pushResultPage(topic.topicId)}
                          className="inline-flex h-11 w-full cursor-pointer items-center justify-between rounded-lg border border-[color:var(--app-border)] bg-[color:var(--app-surface-soft)] px-2.5 text-left transition hover:bg-[color:var(--app-surface-soft-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f0a]/55 lg:h-12 lg:rounded-xl"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[color:var(--app-border)] bg-[color:var(--app-surface-soft-strong)] text-[11px] font-bold text-[color:var(--app-text-primary)]">
                              {index + 1}
                            </span>
                            <span className="truncate text-[12px] font-medium text-[color:var(--app-text-primary)] lg:text-[13px]">{topic.title}</span>
                          </div>
                          <span className="ml-2 shrink-0 text-[11px] font-semibold text-[#8fb8ff] lg:text-xs">
                            {topic.voteCount.toLocaleString()}표
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[12px] text-[color:var(--app-text-muted)]">
                      {isKoreaSelected
                        ? regionHotTopicsError ?? '이 지역의 인기 주제 데이터가 아직 충분하지 않습니다.'
                        : '현재 이 국가는 지역 인기 주제 TOP 3를 준비 중입니다.'}
                    </p>
                  )}
                </div>
              </section>
            ) : null}
          </div>

          <div className="h-3 md:hidden" />
        </div>

        <div
          className="pointer-events-none absolute inset-0 z-30 hidden md:flex md:flex-col"
          style={{ backgroundColor: desktopColors.bg }}
        >
          {isDesktopViewport ? (
            <div className="pointer-events-auto absolute inset-0 z-0 overflow-hidden">
              <BaseCountryAdminMap
                {...sharedGlobalMapProps}
                showTooltip={isKoreaSelected}
                tooltipPinOnClick={isKoreaSelected}
                renderTooltipContent={isKoreaSelected ? renderDesktopRegionTooltip : undefined}
                onTooltipRegionChange={isKoreaSelected ? setDesktopTooltipRegion : undefined}
                className="h-full w-full !rounded-none !border-0"
              />
            </div>
          ) : null}

          {!isMapLayoutFullscreen ? (
            <DesktopTopHeader
              className="pointer-events-auto relative z-20"
              links={[
                { key: 'home', label: '홈', active: activeTab === 'home', onClick: () => handleBottomTabClick('home') },
                { key: 'map', label: '지도', active: activeTab === 'map', onClick: () => handleBottomTabClick('map') },
                { key: 'game', label: '게임', active: activeTab === 'game', onClick: () => handleBottomTabClick('game') },
                { key: 'my', label: 'MY', active: activeTab === 'me', onClick: () => handleBottomTabClick('me') },
              ]}
              rightSlot={(
                <>
                  <button
                    type="button"
                    disabled
                    className="hidden h-10 w-10 items-center justify-center rounded-full text-[color:var(--app-text-muted)] opacity-80 min-[1281px]:inline-flex"
                    aria-label="검색"
                  >
                    <Search className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsDesktopRightPanelOpen((prev) => !prev)}
                    className={`inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-xl border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f0a] max-[1100px]:h-9 max-[1100px]:w-9 max-[1100px]:justify-center max-[1100px]:px-0 ${isDesktopRightPanelOpen
                        ? 'border border-[#ff9f0a88] bg-[#ff6b00] text-white hover:bg-[#ff7a1f]'
                        : 'border border-[color:var(--app-border)] bg-[color:var(--app-surface-soft)] text-[color:var(--app-text-primary)] hover:bg-[color:var(--app-surface-soft-strong)] hover:text-[color:var(--app-text-primary)]'
                      }`}
                    aria-label="결과 분석"
                    title="결과 분석"
                  >
                    <BarChart2 className="h-4 w-4 min-[1101px]:hidden" />
                    <span className="max-[1100px]:sr-only min-[1101px]:inline">결과 분석</span>
                  </button>
                  <CountryTabs
                    selectedCountry={selectedCountry}
                    onSelectCountry={handleCountryTabSelect}
                    desktopExpandable
                  />
                  <AccountMenuButton />
                </>
              )}
            />
          ) : null}

          <div className="relative z-10 flex-1 min-h-0">
            <div className="mx-auto flex h-full min-h-0 w-full" style={{ height: '100%' }}>
              {!isMapLayoutFullscreen ? (
                isDesktopLeftPanelOpen ? (
                  <aside
                    className="pointer-events-auto relative flex h-full w-[420px] min-h-0 shrink-0 flex-col overflow-hidden rounded-r-[24px] border shadow-[4px_0_24px_rgba(0,0,0,0.08)]"
                    style={{
                      backgroundColor: desktopColors.surface,
                      borderColor: desktopColors.border,
                      height: 'calc(100vh - 64px)',
                      maxHeight: 'calc(100vh - 64px)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setIsDesktopLeftPanelOpen(false)}
                      className="absolute -right-[33px] top-1/2 z-20 inline-flex h-[130px] w-8 -translate-y-1/2 items-center justify-center rounded-r-[16px] border border-l-0 transition"
                      style={{ backgroundColor: desktopColors.surface, borderColor: desktopColors.border, color: desktopColors.textSecondary }}
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>

                    <div className="relative shrink-0 border-b px-7 pb-6 pt-10" style={{ borderColor: desktopColors.border }}>
                      <div className="mb-3 flex items-center gap-2">
                        <div className="inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1" style={{ backgroundColor: desktopColors.redSoft }}>
                          <span className="h-1.5 w-1.5 rounded-full animate-ping" style={{ backgroundColor: desktopColors.red }} />
                          <span className="text-[11px] font-bold tracking-wider" style={{ color: desktopColors.red }}>
                            LIVE
                          </span>
                        </div>
                        <span className="flex items-center gap-1 text-[14px] font-bold" style={{ color: desktopColors.textSecondary }}>
                          실시간 누적 투표수
                        </span>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="desktop-home-burn text-[42px] font-extrabold leading-none tracking-tight">
                          {animatedPlatformTotalVotes}
                        </span>
                        <span className="text-[20px] font-bold" style={{ color: desktopColors.textPrimary }}>
                          명이 참여했어요
                        </span>
                      </div>

                      <p className="mt-4 text-[14px] font-medium leading-relaxed" style={{ color: desktopColors.textSecondary }}>
                        지금 이 순간에도 전국 방방곡곡에서
                        <br />
                        새로운 의견들이 모이고 있습니다.
                      </p>
                    </div>

                    <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto" style={{ backgroundColor: desktopColors.surfaceAlt }}>
                      <div className="flex min-h-full flex-col">
                        <div className="flex min-h-full flex-col p-7 pb-28">
                          <div className="mb-2 flex items-center justify-between">
                            <h2 className="inline-flex items-center gap-2 text-[18px] font-bold" style={{ color: desktopColors.textPrimary }}>
                              지금 가장 뜨거운 투표
                              <Zap className="h-5 w-5 text-yellow-500" />
                            </h2>
                          </div>

                          <div className="space-y-4 pb-4">
                            {isScoreboardLoading ? (
                              <div className="space-y-3">
                                <div className="h-32 animate-pulse rounded-[20px]" style={{ backgroundColor: desktopColors.surface }} />
                                <div className="h-32 animate-pulse rounded-[20px]" style={{ backgroundColor: desktopColors.surface }} />
                                <div className="h-32 animate-pulse rounded-[20px]" style={{ backgroundColor: desktopColors.surface }} />
                              </div>
                            ) : popularTopics.length === 0 ? (
                              <div
                                className="rounded-[16px] border border-dashed px-4 py-5 text-sm"
                                style={{ borderColor: desktopColors.border, color: desktopColors.textSecondary }}
                              >
                                {scoreboardError ?? '인기 투표 데이터가 아직 없습니다.'}
                              </div>
                            ) : (
                              popularTopics.map((topic) => {
                                const isExpanded = expandedHotTopicId === topic.topicId;
                                const topicViewer = hotTopicViewerById[topic.topicId];
                                const hasVoted = Boolean(topicViewer?.hasTopicVote);
                                const opensCrossCountryChoice =
                                  hasVoted && (topicViewer?.voteCountryCode ?? viewerSupportedCountry) !== selectedCountry;
                                const canShowDetailedDistribution = hasVoted && topic.hasDistribution;
                                const topicMeta = topicById.get(topic.topicId);
                                const optionA = topicMeta?.options.find((option) => option.position === 1) ?? null;
                                const optionB = topicMeta?.options.find((option) => option.position === 2) ?? null;

                                return (
                                  <div
                                    key={topic.topicId}
                                    className="group w-full rounded-[20px] border p-5 text-left shadow-[0_2px_10px_rgba(0,0,0,0.25)] transition-all duration-300 hover:shadow-[0_12px_28px_rgba(0,0,0,0.36)]"
                                    style={{
                                      borderColor: isExpanded ? desktopColors.blue : desktopColors.border,
                                      backgroundColor: desktopColors.surface,
                                      boxShadow: isExpanded ? '0 0 0 1px rgba(47,116,255,0.45), 0 16px 34px rgba(0,0,0,0.38)' : undefined,
                                    }}
                                  >
                                    <div className="mb-3 flex items-start justify-between">
                                      <div className="flex items-center gap-2">
                                        <span
                                          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-bold"
                                          style={{ backgroundColor: desktopColors.divider, color: desktopColors.textSecondary }}
                                        >
                                          {topic.rank}
                                        </span>
                                        {topic.isHot ? (
                                          <span
                                            className="inline-flex items-center rounded-[6px] border px-2 py-0.5 text-[11px] font-bold"
                                            style={{ borderColor: desktopColors.redSoft, color: desktopColors.red, backgroundColor: desktopColors.redSoft }}
                                          >
                                            HOT
                                          </span>
                                        ) : null}
                                      </div>
                                      <span className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: desktopColors.textSecondary }}>
                                        <Users className="h-3 w-3" /> {topic.totalVotes.toLocaleString()}명
                                      </span>
                                    </div>

                                    <p className="mb-4 line-clamp-2 text-[16px] font-bold leading-snug transition-colors group-hover:text-[#8dbdff]" style={{ color: desktopColors.textPrimary }}>
                                      {topic.title}
                                    </p>

                                    <div className="space-y-1.5">
                                      {canShowDetailedDistribution ? (
                                        <>
                                          <div className="flex items-center justify-between px-1 text-[11px] font-bold" style={{ color: desktopColors.textSecondary }}>
                                            <span>{topic.leftLabel}</span>
                                            <span>{topic.rightLabel}</span>
                                          </div>
                                          <div className="flex h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: desktopColors.divider }}>
                                            <div className="h-full bg-[#ff6b00]" style={{ width: `${topic.leftPercent}%` }} />
                                            <div className="h-full bg-[#2f74ff]" style={{ width: `${topic.rightPercent}%` }} />
                                          </div>
                                        </>
                                      ) : (
                                        <>
                                          <div className="flex items-center justify-between px-1 text-[11px] font-bold" style={{ color: desktopColors.textSecondary }}>
                                            <span>투표 전 결과 비공개</span>
                                            <span>격차 {topic.gapPercent}%p · 총 {topic.previewTotalVotes.toLocaleString()}표</span>
                                          </div>
                                          <div className="flex h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: desktopColors.divider }}>
                                            <div className="h-full w-full bg-gray-500" />
                                          </div>
                                        </>
                                      )}
                                    </div>

                                    <div className="mt-4">
                                      {!isExpanded && !hasVoted ? (
                                        <button
                                          type="button"
                                          onClick={() => handleDesktopHotTopicToggle(topic.topicId)}
                                          className="w-full rounded-[12px] py-2.5 text-[13px] font-bold transition-colors"
                                          style={{ backgroundColor: desktopColors.buttonBg, color: desktopColors.textPrimary }}
                                        >
                                          투표하기
                                        </button>
                                      ) : null}

                                      {isExpanded && !hasVoted ? (
                                        <div className="mt-1 border-t pt-4" style={{ borderColor: desktopColors.border }}>
                                          {optionA && optionB ? (
                                            <div className="grid grid-cols-2 gap-2">
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  void handleHotTopicImmediateVote({
                                                    topicId: topic.topicId,
                                                    optionKey: optionA.key,
                                                    optionAKey: optionA.key,
                                                    optionBKey: optionB.key,
                                                  })
                                                }
                                                disabled={isHotTopicSubmittingVote}
                                                className="rounded-[12px] bg-[#ff6b00]/10 py-3 text-[14px] font-bold text-[#ffad63] transition-colors hover:bg-[#ff6b00]/22 disabled:cursor-not-allowed disabled:opacity-60"
                                              >
                                                {optionA.label}
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  void handleHotTopicImmediateVote({
                                                    topicId: topic.topicId,
                                                    optionKey: optionB.key,
                                                    optionAKey: optionA.key,
                                                    optionBKey: optionB.key,
                                                  })
                                                }
                                                disabled={isHotTopicSubmittingVote}
                                                className="rounded-[12px] bg-[#2f74ff]/10 py-3 text-[14px] font-bold text-[#8dbdff] transition-colors hover:bg-[#2f74ff]/22 disabled:cursor-not-allowed disabled:opacity-60"
                                              >
                                                {optionB.label}
                                              </button>
                                            </div>
                                          ) : (
                                            <p className="text-xs" style={{ color: desktopColors.red }}>
                                              선택지 정보를 불러오지 못했습니다.
                                            </p>
                                          )}

                                          {selectedCountry !== viewerSupportedCountry ? (
                                            <p className="mt-2 text-xs" style={{ color: desktopColors.red }}>
                                              지금 투표하면 {viewerSupportedCountry} 기준 결과에 반영됩니다.
                                            </p>
                                          ) : hotTopicVoteMessage ? (
                                            <p className="mt-2 text-xs" style={{ color: desktopColors.red }}>
                                              {hotTopicVoteMessage}
                                            </p>
                                          ) : null}
                                        </div>
                                      ) : null}

                                      {hasVoted ? (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (opensCrossCountryChoice) {
                                              openResultScopeChooser(
                                                topic.topicId,
                                                topic.title,
                                                topicViewer?.voteCountryCode ?? viewerSupportedCountry,
                                              );
                                              return;
                                            }
                                            pushResultPage(topic.topicId);
                                          }}
                                          className="mt-3 w-full rounded-[12px] border py-2.5 text-center text-[13px] font-bold transition-colors"
                                          style={{
                                            borderColor: 'rgba(47,116,255,0.42)',
                                            backgroundColor: 'rgba(47,116,255,0.2)',
                                            color: '#8dbdff',
                                          }}
                                        >
                                          {opensCrossCountryChoice ? '결과 보기 선택' : '결과보기'}
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>

                          <section
                            className="rounded-[16px] border p-3.5"
                            style={{ borderColor: desktopColors.border, backgroundColor: desktopColors.surface }}
                          >
                            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: desktopColors.textSecondary }}>
                              광고
                            </p>
                            <AdSenseSlot
                              slot={ADSENSE_SLOTS.desktopLeftPanel}
                              minHeight={90}
                              fallbackText="좌측 패널 스폰서 배너 영역입니다."
                              fallbackClassName="text-[13px]"
                            />
                          </section>

                        </div>

                      </div>
                    </div>

                    <div
                      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-6 pb-5 pt-10"
                      style={{
                        background: `linear-gradient(to top, ${desktopColors.surfaceAlt} 52%, rgba(0,0,0,0) 100%)`,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setIsTopicPickerOpen(true)}
                        className="pointer-events-auto inline-flex h-14 w-full items-center justify-center gap-2 rounded-[16px] border text-[16px] font-bold shadow-[0_8px_20px_rgba(0,0,0,0.28)] transition"
                        style={{
                          backgroundColor: desktopColors.buttonBg,
                          borderColor: desktopColors.border,
                          color: desktopColors.textPrimary,
                        }}
                      >
                        주제 전체보기
                        <ChevronRight className="h-4 w-4" style={{ color: desktopColors.textSecondary }} />
                      </button>
                    </div>
                  </aside>
                ) : null
              ) : null}

              <div className="relative min-w-0 flex-1">
                <button
                  type="button"
                  onClick={handleMapLayoutFullscreenToggle}
                  className="pointer-events-auto absolute right-6 top-6 z-30 inline-flex h-11 items-center gap-2 rounded-[12px] border px-4 text-[14px] font-bold transition"
                  style={{
                    backgroundColor: desktopColors.surface,
                    borderColor: desktopColors.border,
                    color: desktopColors.textPrimary,
                  }}
                >
                  {isMapLayoutFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  <span>{isMapLayoutFullscreen ? '기본 보기' : '전체 화면'}</span>
                </button>

              </div>

              {!isMapLayoutFullscreen ? (
                isDesktopRightPanelOpen ? (
                  <aside
                    className="pointer-events-auto relative flex w-[360px] min-h-0 shrink-0 flex-col border-l"
                    style={{ backgroundColor: desktopColors.surface, borderColor: desktopColors.border }}
                  >
                    <button
                      type="button"
                      onClick={() => setIsDesktopRightPanelOpen(false)}
                      className="absolute -left-[33px] top-1/2 z-20 inline-flex h-[130px] w-8 -translate-y-1/2 items-center justify-center rounded-l-[16px] border border-r-0"
                      style={{ backgroundColor: desktopColors.surface, borderColor: desktopColors.border, color: desktopColors.textSecondary }}
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>

                    <div className="flex items-center justify-between border-b px-6 py-5" style={{ borderColor: desktopColors.border }}>
                      <h2 className="inline-flex items-center gap-2 text-[18px] font-bold" style={{ color: desktopColors.textPrimary }}>
                        <BarChart2 className="h-5 w-5" style={{ color: desktopColors.blue }} />
                        상세 결과 분석
                      </h2>
                    </div>

                    <div className="custom-scrollbar min-h-0 flex-1 space-y-7 overflow-y-auto p-6" style={{ backgroundColor: desktopColors.surfaceAlt }}>
                      <section>
                        <div className="rounded-[16px] border p-3.5" style={{ borderColor: desktopColors.border, backgroundColor: desktopColors.surface }}>
                          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: desktopColors.textSecondary }}>
                            광고
                          </p>
                          <AdSenseSlot
                            slot={ADSENSE_SLOTS.desktopRightPanel}
                            minHeight={250}
                            fallbackText="데스크톱 스폰서 배너 영역입니다."
                            fallbackClassName="text-sm"
                          />
                        </div>
                      </section>

                      <section>
                        <h3 className="text-[15px] font-bold" style={{ color: desktopColors.textPrimary }}>
                          연령별 참여 비율
                        </h3>
                        <div className="mt-3 rounded-[16px] border p-4" style={{ borderColor: desktopColors.border, backgroundColor: desktopColors.surface }}>
                          {isHomeAnalyticsLoading ? (
                            <div className="space-y-2">
                              <div className="h-7 animate-pulse rounded-lg" style={{ backgroundColor: desktopColors.divider }} />
                              <div className="h-7 animate-pulse rounded-lg" style={{ backgroundColor: desktopColors.divider }} />
                              <div className="h-7 animate-pulse rounded-lg" style={{ backgroundColor: desktopColors.divider }} />
                              <div className="h-7 animate-pulse rounded-lg" style={{ backgroundColor: desktopColors.divider }} />
                              <div className="h-7 animate-pulse rounded-lg" style={{ backgroundColor: desktopColors.divider }} />
                            </div>
                          ) : ageDistributionRows.length === 0 ? (
                            <p className="text-sm" style={{ color: desktopColors.textSecondary }}>
                              {homeAnalyticsError ?? '연령별 데이터가 없습니다.'}
                            </p>
                          ) : (
                            <div className="space-y-2.5">
                              {ageDistributionRows.map((row) => (
                                <div key={row.label}>
                                  <div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold" style={{ color: desktopColors.textSecondary }}>
                                    <span>{row.label}</span>
                                    <span>
                                      {row.percent.toFixed(1)}% · {row.count.toLocaleString()}명
                                    </span>
                                  </div>
                                  <div className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: desktopColors.divider }}>
                                    <div className="h-full rounded-full" style={{ width: `${row.percent}%`, backgroundColor: desktopColors.blue }} />
                                  </div>
                                </div>
                              ))}
                              <p className="pt-1 text-[11px]" style={{ color: desktopColors.textSecondary }}>
                                기준: 회원 투표 데이터({homeAnalytics ? homeAnalytics.age.knownTotal.toLocaleString() : '0'}건)
                              </p>
                            </div>
                          )}
                        </div>
                      </section>

                      <section>
                        <h3 className="text-[15px] font-bold" style={{ color: desktopColors.textPrimary }}>
                          성별 참여 비율
                        </h3>
                        <div className="mt-3 grid grid-cols-2 gap-4">
                          <div className="rounded-[16px] border px-4 py-4" style={{ borderColor: 'rgba(47,116,255,0.42)', backgroundColor: 'rgba(47,116,255,0.16)' }}>
                            <p className="text-[26px] font-extrabold" style={{ color: desktopColors.blue }}>
                              {isHomeAnalyticsLoading ? '-' : `${homeAnalytics ? homeAnalytics.gender.male.percent.toFixed(1) : '0.0'}%`}
                            </p>
                            <p className="mt-1 text-[13px] font-semibold" style={{ color: desktopColors.textSecondary }}>
                              남성 · {(homeAnalytics?.gender.male.count ?? 0).toLocaleString()}명
                            </p>
                          </div>
                          <div className="rounded-[16px] border px-4 py-4" style={{ borderColor: 'rgba(255,107,0,0.42)', backgroundColor: 'rgba(255,107,0,0.16)' }}>
                            <p className="text-[26px] font-extrabold" style={{ color: desktopColors.red }}>
                              {isHomeAnalyticsLoading ? '-' : `${homeAnalytics ? homeAnalytics.gender.female.percent.toFixed(1) : '0.0'}%`}
                            </p>
                            <p className="mt-1 text-[13px] font-semibold" style={{ color: desktopColors.textSecondary }}>
                              여성 · {(homeAnalytics?.gender.female.count ?? 0).toLocaleString()}명
                            </p>
                          </div>
                        </div>
                        <p className="mt-2 text-[11px]" style={{ color: desktopColors.textSecondary }}>
                          기타 {(homeAnalytics?.gender.otherCount ?? 0).toLocaleString()}명 · 미상 {(homeAnalytics?.gender.unknownCount ?? 0).toLocaleString()}명
                        </p>
                      </section>
                    </div>
                  </aside>
                ) : null
              ) : null}
            </div>

            {!isMapLayoutFullscreen && !isDesktopLeftPanelOpen ? (
              <button
                type="button"
                onClick={() => setIsDesktopLeftPanelOpen(true)}
                className="pointer-events-auto absolute left-0 top-1/2 z-20 inline-flex h-[130px] w-8 -translate-y-1/2 items-center justify-center rounded-r-[16px] border border-l-0 transition"
                style={{ backgroundColor: desktopColors.surface, borderColor: desktopColors.border, color: desktopColors.textSecondary }}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : null}

            {!isMapLayoutFullscreen && !isDesktopRightPanelOpen ? (
              <button
                type="button"
                onClick={() => setIsDesktopRightPanelOpen(true)}
                className="pointer-events-auto absolute right-0 top-1/2 z-20 inline-flex h-[130px] w-8 -translate-y-1/2 items-center justify-center rounded-l-[16px] border border-r-0 transition"
                style={{ backgroundColor: desktopColors.surface, borderColor: desktopColors.border, color: desktopColors.textSecondary }}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            ) : null}
          </div>
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
            className="pointer-events-auto border-t border-[color:var(--app-border)] bg-[color:var(--app-dock-bg)] pb-[calc(0.55rem+env(safe-area-inset-bottom))] pt-2 shadow-[var(--app-dock-shadow)] backdrop-blur-2xl"
            style={{ touchAction: 'pan-y' }}
          >
            <div className="mx-auto max-w-[430px] px-3">
              <section className="rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-dock-inner)] px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-6 shrink-0 items-center rounded-md border border-[#ff9f0a66] bg-[#ff9f0a22] px-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#ffcc8a]">
                    광고
                  </span>
                  <div className="min-w-0 flex-1">
                    <AdSenseSlot slot={ADSENSE_SLOTS.mobileDock} minHeight={44} />
                  </div>
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
          <nav className="pointer-events-auto rounded-t-[24px] border-t border-[color:var(--app-border)] bg-[color:var(--app-dock-bg)] pb-2 pt-2 shadow-[var(--app-dock-shadow)] backdrop-blur-2xl">
            <div ref={bottomMenuGridRef} className="mx-auto grid max-w-[430px] grid-cols-4 gap-2 px-3">
              {[
                { id: 'home' as const, label: '홈' },
                { id: 'map' as const, label: '지도' },
                { id: 'game' as const, label: '게임' },
                { id: 'me' as const, label: 'MY' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  ref={tab.id === 'map' ? mapTabButtonRef : undefined}
                  onClick={() => handleBottomTabClick(tab.id)}
                  className={`inline-flex h-11 items-center justify-center rounded-2xl text-[14px] font-semibold transition ${activeTab === tab.id ? 'bg-[color:var(--app-dock-inner)] text-[#ff9f0a]' : 'text-[color:var(--app-text-muted)] hover:text-[color:var(--app-text-primary)]'
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </nav>
        </div>

        <div
          className={`pointer-events-none absolute inset-x-0 z-30 transition-opacity duration-200 md:hidden ${isTopicPickerOpen ? 'opacity-0' : 'opacity-100'
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
                  <span
                    className="whitespace-nowrap text-[11px] font-semibold tracking-[-0.01em]"
                    style={{
                      color: mobileTopicHintPalette.textColor,
                      textShadow: mobileTopicHintPalette.textShadow,
                    }}
                  >
                    여기서 다른 주제를 선택하세요
                  </span>
                  <svg
                    className="home-chevron mt-0.5"
                    style={{ filter: mobileTopicHintPalette.svgFilter }}
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
                        stroke={mobileTopicHintPalette.chevronStrokePrimary}
                        strokeWidth={mobileTopicHintPalette.chevronStrokeWidth}
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
            className="fixed inset-0 z-40 flex items-center justify-center bg-[color:var(--app-overlay)] p-4"
            onClick={handleTopicPickerClose}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="home-topic-picker-title"
              className="w-full max-w-[860px] overflow-hidden rounded-[28px] border border-[color:var(--app-border)] bg-[color:var(--app-surface-elevated)] shadow-[var(--app-modal-shadow)] backdrop-blur-2xl"
              style={{ maxHeight: 'calc(100dvh - 2rem)' }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-[color:var(--app-border)] px-5 pb-3 pt-4">
                <div>
                  <h4 id="home-topic-picker-title" className="text-[20px] font-semibold text-[color:var(--app-text-primary)]">
                    다른 주제 선택
                  </h4>
                  <p className="mt-1 text-xs text-[color:var(--app-text-muted)]">선택하면 바로 투표 카드가 펼쳐집니다.</p>
                </div>
                <button
                  type="button"
                  aria-label="주제 선택 팝업 닫기"
                  onClick={handleTopicPickerClose}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface-soft)] text-lg text-[color:var(--app-text-secondary)] transition hover:bg-[color:var(--app-surface-soft-strong)] hover:text-[color:var(--app-text-primary)]"
                >
                  ×
                </button>
              </div>

              <div className="px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
                {isTopicsLoading ? (
                  <div className="rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface-soft)] px-3 py-3 text-sm text-[color:var(--app-text-secondary)]">
                    주제 불러오는 중...
                  </div>
                ) : availableTopics.length === 0 ? (
                  <div className="rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface-soft)] px-3 py-3 text-sm text-[color:var(--app-text-secondary)]">
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
                            className={`shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition ${isActive
                                ? topicPickerPalette.activeTabClass
                                : 'border-[color:var(--app-border)] bg-[color:var(--app-surface-soft)] text-[color:var(--app-text-muted)] hover:bg-[color:var(--app-surface-soft-strong)] hover:text-[color:var(--app-text-primary)]'
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
                        <div className="rounded-xl border border-dashed border-[color:var(--app-border)] bg-[color:var(--app-surface-soft)] px-3 py-3 text-sm text-[color:var(--app-text-muted)]">
                          이 카테고리에 표시할 주제가 없습니다.
                        </div>
                      ) : (
                        <div className="space-y-2 pb-1">
                          {filteredTopics.map((topic) => {
                            const optionA = topic.options.find((option) => option.position === 1) ?? null;
                            const optionB = topic.options.find((option) => option.position === 2) ?? null;
                            const isExpanded = expandedPickerTopicId === topic.id;
                            const topicViewer = hotTopicViewerById[topic.id];
                            const hasTopicVote = Boolean(topicViewer?.hasTopicVote);
                            const isSelectionReady = Boolean(
                              pickerSelectedOptionKey &&
                                optionA &&
                                optionB &&
                                !isPickerSubmittingVote,
                            );

                            return (
                              <div
                                key={topic.id}
                                className={`rounded-xl border bg-[color:var(--app-surface-soft)] transition-colors duration-300 ${isExpanded ? topicPickerPalette.expandedCardClass : 'border-[color:var(--app-border)]'
                                  }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => handleTopicPickerToggle(topic.id)}
                                  className="flex h-11 w-full items-center justify-between gap-3 px-3 text-left text-[color:var(--app-text-primary)] transition hover:bg-[color:var(--app-surface-soft)]"
                                >
                                  <p className="line-clamp-1 text-[14px] font-medium leading-5">{topic.title}</p>
                                  <span className={`inline-flex h-6 shrink-0 items-center justify-center rounded-full border px-2 text-[11px] font-semibold ${topicPickerPalette.actionPillClass}`}>
                                    {isExpanded ? '닫기' : '투표'}
                                  </span>
                                </button>

                                <div
                                  className={`overflow-hidden transition-[max-height,opacity,transform] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] ${isExpanded ? 'max-h-[320px] opacity-100 translate-y-0' : 'pointer-events-none max-h-0 -translate-y-1 opacity-0'
                                    }`}
                                >
                                  <div className="border-t border-[color:var(--app-border)] px-3 pb-3 pt-2.5">
                                    <p className="text-[12px] text-[color:var(--app-text-muted)]">선택지를 고르고 바로 투표하세요.</p>
                                    {optionA && optionB ? (
                                      <>
                                        <div className="mt-2 grid grid-cols-2 gap-2">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setPickerSelectedOptionKey(optionA.key);
                                              setPickerVoteMessage(null);
                                            }}
                                            className={`inline-flex h-11 items-center justify-center rounded-xl border px-2 text-[13px] font-semibold transition ${pickerSelectedOptionKey === optionA.key
                                                ? topicPickerPalette.optionASelectedClass
                                                : 'border-[color:var(--app-border)] bg-[color:var(--app-surface-soft)] text-[color:var(--app-text-muted)] hover:bg-[color:var(--app-surface-soft-strong)]'
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
                                            className={`inline-flex h-11 items-center justify-center rounded-xl border px-2 text-[13px] font-semibold transition ${pickerSelectedOptionKey === optionB.key
                                                ? 'border-[#4ea1ff88] bg-[#2f7cff2e] text-[#cfe2ff]'
                                                : 'border-[color:var(--app-border)] bg-[color:var(--app-surface-soft)] text-[color:var(--app-text-muted)] hover:bg-[color:var(--app-surface-soft-strong)]'
                                              }`}
                                          >
                                            {optionB.label}
                                          </button>
                                        </div>
                                        {selectedCountry !== viewerSupportedCountry ? (
                                          <p className={`mt-2 text-xs ${topicPickerPalette.helperTextClass}`}>
                                            지금 투표하면 {viewerSupportedCountry} 기준 결과에 반영됩니다.
                                          </p>
                                        ) : pickerVoteMessage ? (
                                          <p className={`mt-2 text-xs ${topicPickerPalette.helperTextClass}`}>{pickerVoteMessage}</p>
                                        ) : null}
                                        <button
                                          type="button"
                                          onClick={() => void handleTopicPickerVoteSubmit(topic)}
                                          disabled={!isSelectionReady}
                                          className={`mt-2 inline-flex h-11 w-full items-center justify-center rounded-xl border text-[13px] font-bold transition ${topicPickerPalette.submitClass} disabled:cursor-not-allowed disabled:border-[color:var(--app-border)] disabled:bg-[color:var(--app-surface-soft)] disabled:text-[color:var(--app-text-subtle)]`}
                                        >
                                          {isPickerSubmittingVote
                                            ? '처리 중...'
                                            : hasTopicVote && (topicViewer?.voteCountryCode ?? viewerSupportedCountry) !== selectedCountry
                                              ? '결과 보기 선택'
                                              : hasTopicVote
                                                ? '결과 보기'
                                              : '투표 후 결과 보기'}
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
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-[color:var(--app-overlay)] p-4 sm:items-center">
            <div className="w-full max-w-[430px] rounded-[28px] border border-[color:var(--app-border)] bg-[color:var(--app-surface-elevated)] p-5 shadow-[var(--app-modal-shadow)] backdrop-blur-2xl">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-[20px] font-semibold text-[color:var(--app-text-primary)]">최초 투표 지역 입력</h4>
                <button
                  type="button"
                  onClick={() => {
                    setShowProfileModal(false);
                    setVoteAfterProfile(false);
                    setPendingPickerVote(null);
                    setPendingHotTopicVote(null);
                    setProfileModalMessage(null);
                  }}
                  className="rounded-lg px-2 py-1 text-sm text-[color:var(--app-text-muted)] hover:bg-[color:var(--app-surface-soft)] hover:text-[color:var(--app-text-primary)]"
                >
                  닫기
                </button>
              </div>

              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-[color:var(--app-text-secondary)]">{regionModalHintText}</p>

                {canSelectSchoolInModal ? (
                  <>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-[color:var(--app-text-muted)]">학교 검색</span>
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
                        className="h-10 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface-soft)] px-3 text-sm text-[color:var(--app-text-primary)] outline-none placeholder:text-[color:var(--app-text-subtle)] transition focus:border-[#ff9f0a66]"
                      />
                      {isSchoolListVisible ? (
                        <div
                          ref={schoolResultsListRef}
                          className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface-strong)] p-1.5"
                        >
                          {isSchoolSearching ? (
                            <p className="px-2 py-2 text-xs text-[color:var(--app-text-muted)]">학교 검색 중...</p>
                          ) : schoolResults.length === 0 ? (
                            <p className="px-2 py-2 text-xs text-[color:var(--app-text-subtle)]">검색 결과가 없습니다.</p>
                          ) : (
                            schoolResults.map((school, index) => (
                              <button
                                key={`${school.source}:${school.schoolCode}`}
                                data-school-index={index}
                                type="button"
                                onMouseEnter={() => setHighlightedSchoolIndex(index)}
                                onClick={() => handleSelectSchool(school)}
                                className={`mb-1 block w-full rounded-lg px-2 py-2 text-left text-sm text-[color:var(--app-text-primary)] transition last:mb-0 ${index === highlightedSchoolIndex ? 'bg-[color:var(--app-surface-soft-strong)]' : 'hover:bg-[color:var(--app-surface-soft)]'
                                  }`}
                              >
                                <p className="font-semibold">{school.schoolName}</p>
                                <p className="mt-0.5 text-[11px] text-[color:var(--app-text-subtle)]">
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
                            className="rounded-md border border-[color:var(--app-border)] bg-[color:var(--app-surface-soft)] px-2 py-0.5 text-[11px] text-[color:var(--app-text-muted)] transition hover:bg-[color:var(--app-surface-soft-strong)]"
                          >
                            학교 선택 해제
                          </button>
                        </div>
                      ) : null}
                    </label>

                    {canUseGpsForViewer ? (
                      <div className="flex items-center gap-2">
                        <div className="h-px flex-1 bg-[color:var(--app-border)]" />
                        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--app-text-subtle)]">또는</span>
                        <div className="h-px flex-1 bg-[color:var(--app-border)]" />
                      </div>
                    ) : null}
                  </>
                ) : null}

                {canUseGpsForViewer ? (
                  <div className="space-y-2 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface-soft)] p-3">
                    <button
                      type="button"
                      onClick={() => void handleUseCurrentLocation()}
                      disabled={isLocatingRegion}
                      className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface-soft-strong)] px-3 text-sm font-semibold text-[color:var(--app-text-primary)] transition hover:bg-[color:var(--app-surface-soft-strong)] disabled:cursor-not-allowed disabled:opacity-70"
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
                          className="rounded-md border border-[color:var(--app-border)] bg-[color:var(--app-surface-soft-strong)] px-2 py-0.5 text-[11px] text-[color:var(--app-text-muted)] transition hover:bg-[color:var(--app-surface-soft-strong)]"
                        >
                          위치 선택 해제
                        </button>
                      </div>
                    ) : (
                      <p className="text-[11px] text-[color:var(--app-text-subtle)]">위치 허용 시 시/도·시군구 코드만 저장합니다.</p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface-soft)] p-3 text-[11px] text-[color:var(--app-text-secondary)]">
                    국내 사용자의 GPS 위치 기능은 현재 출시 준비 중입니다.
                  </div>
                )}

                {profileModalMessage ? (
                  <p className="rounded-lg border border-[color:var(--app-border)] bg-[color:var(--app-surface-soft)] px-3 py-2 text-xs text-[color:var(--app-text-primary)]">
                    {profileModalMessage}
                  </p>
                ) : null}

                <button
                  type="button"
                  onClick={() => void handleSaveRegionOnly()}
                  disabled={!hasPendingRegionInput || isLocatingRegion}
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
        .desktop-home-burn {
          background: linear-gradient(90deg, #ff6b00, #ff9f0a, #ff6b00);
          background-size: 220% auto;
          animation: desktop-home-burn 2.3s linear infinite;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          text-shadow: 0 2px 10px rgba(255, 107, 0, 0.24);
        }
        @keyframes desktop-home-burn {
          0% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.22);
          border-radius: 9999px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(255, 255, 255, 0.32);
        }
        .home-chevron-group > use {
          animation: home-chevron-appear 2s ease-in-out infinite;
          opacity: 0;
          transform-box: fill-box;
          transform-origin: center;
        }
        .home-chevron-group > use:nth-child(1) {
          --base: 0px;
          animation-delay: 0s;
          stroke: ${mobileTopicHintPalette.chevronStrokePrimary};
        }
        .home-chevron-group > use:nth-child(2) {
          --base: 20px;
          animation-delay: 0.25s;
          stroke: ${mobileTopicHintPalette.chevronStrokeSecondary};
        }
        .home-chevron-group > use:nth-child(3) {
          --base: 40px;
          animation-delay: 0.5s;
          stroke: ${mobileTopicHintPalette.chevronStrokeTertiary};
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

      <section className="hidden border-t border-[color:var(--app-border)] bg-[color:var(--app-dock-bg)] py-3 md:block">
        <div className="mx-auto w-full max-w-[1280px] px-6">
          <div className="flex items-center gap-3 rounded-[14px] border border-[color:var(--app-border)] bg-[color:var(--app-dock-inner)] px-4 py-3">
            <span className="inline-flex h-6 shrink-0 items-center rounded-md border border-[#ff9f0a66] bg-[#ff9f0a22] px-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#ffcc8a]">
              광고
            </span>
            <div className="min-w-0 flex-1">
              <AdSenseSlot
                slot={ADSENSE_SLOTS.desktopBottom}
                minHeight={90}
                fallbackText="데스크톱 하단 스폰서 배너 영역입니다."
              />
            </div>
          </div>
        </div>
      </section>

      <VoteResultScopeChooser
        isOpen={Boolean(resultScopeChooser)}
        onClose={closeResultScopeChooser}
        topicTitle={resultScopeChooser?.topicTitle ?? '결과 보기'}
        scopeCountryName={
          resultScopeChooser ? getCountryMapConfig(resultScopeChooser.scopeCountryCode).displayName : '현재 국가'
        }
        voteCountryName={
          resultScopeChooser ? getCountryMapConfig(resultScopeChooser.voteCountryCode).displayName : '내 국가'
        }
        onOpenScopeResult={handleOpenScopeResult}
        onOpenVoteCountryResult={handleOpenVoteCountryResult}
        reducedMotion={false}
      />

      <div>
        <SiteLegalFooter containerMaxWidthClassName="max-w-[1280px]" />
      </div>
    </div>
  );
}
