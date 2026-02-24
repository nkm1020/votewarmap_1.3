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
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  clearGuestSessionId,
  clearPendingRegionInput,
  clearPendingVotes,
  readGuestSessionId,
} from '@/lib/vote/client-storage';
import type { Gender } from '@/lib/vote/types';

type UserProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  nickname: string | null;
  avatar_url: string | null;
  avatar_preset: string | null;
  provider: string | null;
  birth_year: number | null;
  gender: 'male' | 'female' | 'other' | 'prefer_not_to_say' | null;
  school_id: string | null;
  sido_code: string | null;
  sigungu_code: string | null;
  signup_completed_at: string | null;
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
  avatarPreset: string;
  birthYear: number;
  gender: Gender;
};

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isSignupCompleted: boolean;
  requiresSignupCompletion: boolean;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  completeSignup: (input: CompleteSignupInput) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function profilePayloadFromUser(user: User): UserProfile {
  const synced = userSyncPayloadFromUser(user);
  return {
    ...synced,
    nickname: null,
    avatar_preset: null,
    birth_year: null,
    gender: null,
    school_id: null,
    sido_code: null,
    sigungu_code: null,
    signup_completed_at: null,
  };
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
    'id, email, full_name, nickname, avatar_url, avatar_preset, provider, birth_year, gender, school_id, sido_code, sigungu_code, signup_completed_at';

  const { data, error } = await supabase
    .from('users')
    .select(fullSelect)
    .eq('id', userId)
    .maybeSingle();

  if (error?.message.toLowerCase().includes('column')) {
    const { data: legacyData, error: legacyError } = await supabase
      .from('users')
      .select('id, email, full_name, avatar_url, provider, birth_year, gender, school_id, sido_code, sigungu_code')
      .eq('id', userId)
      .maybeSingle();

    if (legacyError) {
      console.error('[auth] failed to fetch profile (legacy):', legacyError.message);
      return null;
    }

    if (!legacyData) {
      return null;
    }

    return {
      ...legacyData,
      nickname: null,
      avatar_preset: null,
      signup_completed_at: null,
    };
  }

  if (error) {
    console.error('[auth] failed to fetch profile:', error.message);
    return null;
  }

  return data;
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

  const signInWithOAuth = useCallback(async (provider: 'google') => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      return { error: 'Supabase 환경변수(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)가 필요합니다.' };
    }

    const redirectTo = `${window.location.origin}/auth`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        scopes: 'openid email',
      },
    });

    return { error: error?.message ?? null };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    return signInWithOAuth('google');
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
          return { error: json.error ?? '회원가입 완료 처리에 실패했습니다.' };
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
        return { error: '회원가입 완료 처리에 실패했습니다.' };
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
