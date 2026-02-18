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
import { LOCAL_STORAGE_KEYS } from '@/lib/vote/constants';
import { clearPendingProfile, clearPendingVotes } from '@/lib/vote/client-storage';

type UserProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  provider: string | null;
  birth_year: number | null;
  gender: 'male' | 'female' | 'other' | 'prefer_not_to_say' | null;
  school_id: string | null;
  sido_code: string | null;
  sigungu_code: string | null;
};

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function profilePayloadFromUser(user: User): UserProfile {
  return {
    id: user.id,
    email: user.email ?? null,
    full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatar_url: user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null,
    provider: user.app_metadata?.provider ?? null,
    birth_year: null,
    gender: null,
    school_id: null,
    sido_code: null,
    sigungu_code: null,
  };
}

async function syncUserToPublicUsers(user: User): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return;
  }

  const payload = profilePayloadFromUser(user);
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

  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, avatar_url, provider, birth_year, gender, school_id, sido_code, sigungu_code')
    .eq('id', userId)
    .maybeSingle();

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

    const guestToken = localStorage.getItem(LOCAL_STORAGE_KEYS.guestToken);
    if (!guestToken) {
      mergedUserRef.current = session.user.id;
      return;
    }

    const response = await fetch('/api/votes/merge-guest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ guestToken }),
    });

    if (response.ok) {
      clearPendingVotes();
      clearPendingProfile();
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

  const signInWithGoogle = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      return { error: 'Supabase 환경변수(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)가 필요합니다.' };
    }

    const redirectTo = `${window.location.origin}/auth`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });

    return { error: error?.message ?? null };
  }, []);

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

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      isLoading,
      isAuthenticated: !!user,
      signInWithGoogle,
      signOut,
      refreshProfile,
    }),
    [user, profile, isLoading, signInWithGoogle, signOut, refreshProfile],
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
