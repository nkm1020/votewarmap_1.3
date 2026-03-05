'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { normalizeInternalRedirectPath } from '@/lib/auth/redirect';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  clearGuestSessionId,
  clearPendingRegionInput,
  clearPendingVotes,
  readGuestSessionId,
} from '@/lib/vote/client-storage';

type UserProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  nickname: string | null;
  username: string | null;
  avatar_url: string | null;
  avatar_preset: string | null;
  provider: string | null;
  birth_year: number | null;
  gender: 'male' | 'female' | 'other' | 'prefer_not_to_say' | null;
  school_id: string | null;
  country_code: string;
  sido_code: string | null;
  sigungu_code: string | null;
  signup_completed_at: string | null;
  privacy_show_leaderboard_name: boolean;
  privacy_show_region: boolean;
  privacy_show_activity_history: boolean;
};

type UserSyncPayload = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  provider: string | null;
};

type CompleteSignupInput = {
  nickname: string;
  birthYear: number;
  gender: 'male' | 'female';
  agreedToTerms: true;
};

type OAuthSignInOptions = {
  redirectPath?: string;
};

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isSignupCompleted: boolean;
  requiresSignupCompletion: boolean;
  signInWithGoogle: (options?: OAuthSignInOptions) => Promise<{ error: string | null }>;
  completeSignup: (input: CompleteSignupInput) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function mapSupabaseAuthErrorMessage(rawMessage: string | null | undefined): string {
  const fallback = '인증 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
  if (!rawMessage) {
    return fallback;
  }

  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes('pwned') ||
    normalized.includes('leaked password') ||
    normalized.includes('compromised password') ||
    normalized.includes('haveibeenpwned')
  ) {
    return '유출 이력이 없는 비밀번호로 다시 설정해 주세요.';
  }

  if (normalized.includes('rate limit') || normalized.includes('too many requests')) {
    return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  }

  if (normalized.includes('invalid login credentials')) {
    return '로그인 정보가 올바르지 않습니다.';
  }

  if (normalized.includes('email not confirmed')) {
    return '이메일 인증이 완료되지 않았습니다.';
  }

  if (normalized.includes('network')) {
    return '네트워크 오류가 발생했습니다. 연결 상태를 확인해 주세요.';
  }

  return rawMessage;
}

function profilePayloadFromUser(user: User): UserProfile {
  const synced = userSyncPayloadFromUser(user);
  return {
    ...synced,
    nickname: null,
    username: null,
    avatar_preset: null,
    birth_year: null,
    gender: null,
    school_id: null,
    country_code: 'KR',
    sido_code: null,
    sigungu_code: null,
    signup_completed_at: null,
    privacy_show_leaderboard_name: true,
    privacy_show_region: false,
    privacy_show_activity_history: false,
  };
}

function normalizeProfileCountryCode(raw: string | null | undefined): string {
  const normalized = String(raw ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : 'KR';
}

function userSyncPayloadFromUser(user: User): UserSyncPayload {
  const provider = user.app_metadata?.provider ?? null;
  const shouldIgnoreSocialAvatar = provider === 'google' || provider === 'kakao';
  return {
    id: user.id,
    email: user.email ?? null,
    full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatar_url: shouldIgnoreSocialAvatar
      ? null
      : (user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null),
    provider,
  };
}

function resolveAppOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim();
  if (!fromEnv) {
    return window.location.origin;
  }

  try {
    const parsed = new URL(fromEnv);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch {
    // Ignore invalid env and fall back to current origin.
  }

  return window.location.origin;
}

async function syncUserToPublicUsers(user: User): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return;
  }

  const payload = userSyncPayloadFromUser(user);
  const { error } = await supabase.from('users').upsert(payload, { onConflict: 'id' });
  if (error) {
    console.error('[auth] failed to upsert users row:', error.message);
  }
}

async function fetchProfile(userId: string): Promise<UserProfile | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return null;
  }

  const fullSelect =
    'id, email, full_name, nickname, username, avatar_url, avatar_preset, provider, birth_year, gender, school_id, country_code, sido_code, sigungu_code, signup_completed_at, privacy_show_leaderboard_name, privacy_show_region, privacy_show_activity_history';

  const { data, error } = await supabase
    .from('users')
    .select(fullSelect)
    .eq('id', userId)
    .maybeSingle();

  if (error?.message.toLowerCase().includes('column')) {
    const { data: legacyData, error: legacyError } = await supabase
      .from('users')
      .select('id, email, full_name, avatar_url, provider, birth_year, gender, school_id, country_code, sido_code, sigungu_code')
      .eq('id', userId)
      .maybeSingle();

    if (legacyError) {
      console.error('[auth] failed to fetch profile (legacy):', legacyError.message);
      return null;
    }

    if (!legacyData) {
      return null;
    }

    const legacyCountryCode = normalizeProfileCountryCode(
      (legacyData as { country_code?: string | null }).country_code,
    );

    return {
      ...legacyData,
      nickname: null,
      username: null,
      avatar_preset: null,
      country_code: legacyCountryCode,
      signup_completed_at: null,
      privacy_show_leaderboard_name: true,
      privacy_show_region: false,
      privacy_show_activity_history: false,
    };
  }

  if (error) {
    console.error('[auth] failed to fetch profile:', error.message);
    return null;
  }

  if (!data) {
    return null;
  }

  return {
    ...data,
    country_code: normalizeProfileCountryCode((data as { country_code?: string | null }).country_code),
  };
}

async function syncCountryCode(accessToken: string | null | undefined): Promise<void> {
  if (!accessToken) {
    return;
  }

  try {
    await fetch('/api/auth/sync-country', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    // Ignore sync failures and keep existing country value.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(() => !!supabase);
  const mergedUserRef = useRef<string | null>(null);

  const mergeGuestVotes = useCallback(async (session: Session | null) => {
    if (typeof window === 'undefined' || !session?.user || !session.access_token) {
      return;
    }

    if (mergedUserRef.current === session.user.id) {
      return;
    }

    const guestSessionId = readGuestSessionId();
    if (!guestSessionId) {
      mergedUserRef.current = session.user.id;
      return;
    }

    const response = await fetch('/api/votes/merge-guest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ guestSessionId }),
    });

    if (response.ok) {
      clearPendingVotes();
      clearPendingRegionInput();
      clearGuestSessionId();
    }

    mergedUserRef.current = session.user.id;
  }, []);

  const applySession = useCallback(async (session: Session | null) => {
    const nextUser = session?.user ?? null;
    setUser(nextUser);

    if (!nextUser) {
      mergedUserRef.current = null;
      setProfile(null);
      return;
    }

    // Keep public.users in sync right after OAuth login as a safety net.
    await syncUserToPublicUsers(nextUser);
    await syncCountryCode(session?.access_token);
    await mergeGuestVotes(session);
    const nextProfile = await fetchProfile(nextUser.id);
    setProfile(nextProfile ?? profilePayloadFromUser(nextUser));
  }, [mergeGuestVotes]);

  const refreshProfile = useCallback(async () => {
    if (!user) {
      setProfile(null);
      return;
    }

    const nextProfile = await fetchProfile(user.id);
    if (nextProfile) {
      setProfile(nextProfile);
    }
  }, [user]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let alive = true;

    const bootstrap = async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) {
        return;
      }

      await applySession(data.session);
      if (alive) {
        setIsLoading(false);
      }
    };

    void bootstrap();

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      void (async () => {
        if (!alive) {
          return;
        }
        await applySession(session);
        if (alive) {
          setIsLoading(false);
        }
      })();
    });

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [applySession, supabase]);

  const signInWithOAuth = useCallback(async (provider: 'google', options?: OAuthSignInOptions) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      return { error: 'Supabase 환경변수(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)가 필요합니다.' };
    }

    const nextPath = normalizeInternalRedirectPath(options?.redirectPath ?? null);
    const appOrigin = resolveAppOrigin();
    const redirectTo =
      nextPath === '/'
        ? `${appOrigin}/auth`
        : `${appOrigin}/auth?next=${encodeURIComponent(nextPath)}`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        scopes: 'openid email',
      },
    });

    return { error: error ? mapSupabaseAuthErrorMessage(error.message) : null };
  }, []);

  const signInWithGoogle = useCallback(async (options?: OAuthSignInOptions) => {
    return signInWithOAuth('google', options);
  }, [signInWithOAuth]);

  const completeSignup = useCallback(
    async (input: CompleteSignupInput) => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        return { error: 'Supabase 환경변수(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)가 필요합니다.' };
      }

      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token ?? null;
      if (!accessToken) {
        return { error: '로그인이 필요합니다.' };
      }

      try {
        const response = await fetch('/api/auth/complete-signup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(input),
        });

        const json = (await response.json()) as { error?: string; profile?: UserProfile };
        if (!response.ok) {
          return { error: mapSupabaseAuthErrorMessage(json.error ?? '회원가입 완료 처리에 실패했습니다.') };
        }

        if (json.profile) {
          setProfile(json.profile);
        } else if (data.session?.user) {
          const nextProfile = await fetchProfile(data.session.user.id);
          if (nextProfile) {
            setProfile(nextProfile);
          }
        }

        return { error: null };
      } catch {
        return { error: mapSupabaseAuthErrorMessage('회원가입 완료 처리에 실패했습니다.') };
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      return;
    }

    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('[auth] signOut failed:', error.message);
    }
  }, []);

  const isSignupCompleted = Boolean(profile?.signup_completed_at);
  const requiresSignupCompletion = Boolean(user) && !isLoading && !isSignupCompleted;

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      isLoading,
      isAuthenticated: !!user,
      isSignupCompleted,
      requiresSignupCompletion,
      signInWithGoogle,
      completeSignup,
      signOut,
      refreshProfile,
    }),
    [
      user,
      profile,
      isLoading,
      isSignupCompleted,
      requiresSignupCompletion,
      signInWithGoogle,
      completeSignup,
      signOut,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
