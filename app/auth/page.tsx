'use client';

import Link from 'next/link';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { DesktopTopHeader } from '@/components/ui/desktop-top-header';
import { useAuth } from '@/contexts/AuthContext';
import { normalizeInternalRedirectPath } from '@/lib/auth/redirect';

const displayFont = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
});

export default function AuthPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, requiresSignupCompletion, signInWithGoogle } = useAuth();
  const [pendingProvider, setPendingProvider] = useState<'google' | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const nextPath = useMemo(() => {
    if (typeof window === 'undefined') {
      return '/';
    }
    const params = new URLSearchParams(window.location.search);
    return normalizeInternalRedirectPath(params.get('next'));
  }, []);
  const signupRedirectPath = useMemo(() => {
    if (nextPath === '/') {
      return '/auth/complete-signup';
    }
    return `/auth/complete-signup?next=${encodeURIComponent(nextPath)}`;
  }, [nextPath]);
  const postAuthRedirectPath = requiresSignupCompletion ? signupRedirectPath : nextPath;

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace(postAuthRedirectPath);
    }
  }, [isAuthenticated, isLoading, postAuthRedirectPath, router]);

  const handleSocialLogin = async () => {
    setAuthError(null);
    setPendingProvider('google');

    const { error } = await signInWithGoogle({ redirectPath: nextPath });
    if (error) {
      setAuthError(error);
      setPendingProvider(null);
    }
  };

  return (
    <main className={`${displayFont.className} relative h-screen w-full overflow-hidden bg-[#181410] text-white`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_70%_at_20%_15%,rgba(47,116,255,0.24),rgba(47,116,255,0)_60%),radial-gradient(80%_60%_at_80%_90%,rgba(255,103,0,0.18),rgba(255,103,0,0)_65%),linear-gradient(to_bottom,rgba(19,15,12,0.95),rgba(19,15,12,0.82))]" />
      <div className="pointer-events-none absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-25 mix-blend-overlay" />

      <div className="relative z-10 mx-auto flex h-full w-full max-w-[1240px] flex-col px-4 pb-8 pt-5 sm:px-6 lg:px-10">
        <DesktopTopHeader
          links={[
            { key: 'home', label: '홈', href: '/' },
            { key: 'map', label: '지도', href: '/topics-map' },
            { key: 'game', label: '게임', href: '/game' },
            { key: 'my', label: 'MY', href: '/my' },
          ]}
          actions={[{ key: 'go-home', label: '홈으로', href: '/', variant: 'outline' }]}
        />

        <header className="flex items-center justify-between gap-3 md:hidden">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#ff8e3b]">Vote War Map</p>
            <p className="text-sm font-bold text-white/95">대한민국 실시간 투표 지도</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/topics-map"
              className="hidden rounded-full border border-white/16 bg-white/8 px-4 py-2 text-xs font-semibold text-white/78 transition hover:bg-white/16 hover:text-white md:inline-flex"
            >
              지도 보기
            </Link>
            <Link
              href="/"
              className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
            >
              홈으로
            </Link>
          </div>
        </header>

        <section className="grid flex-1 items-center gap-7 py-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <article className="hidden rounded-[30px] border border-white/12 bg-[rgba(22,18,14,0.48)] p-7 shadow-2xl backdrop-blur-md lg:block">
            <p className="inline-flex rounded-full border border-[#ff67006a] bg-[#ff670021] px-2.5 py-1 text-[10px] font-bold tracking-wide text-[#ff8e3b]">
              REAL-TIME POLL
            </p>
            <h2 className="mt-4 text-4xl font-extrabold leading-tight text-white">
              지역별 민심 지도를
              <br />
              계정과 함께 시작하세요
            </h2>
            <p className="mt-4 max-w-[480px] text-sm leading-relaxed text-white/70">
              로그인 후 내 지역 기반 분석, 히스토리, 게임 점수 저장 기능을 모두 사용할 수 있습니다.
              회원가입 완료 이전에도 결과와 지도 탐색은 가능합니다.
            </p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {[
                { label: '실시간 판세', value: 'LIVE' },
                { label: '지역 비교', value: '17+ 권역' },
                { label: '투표 주제', value: '매일 업데이트' },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/12 bg-white/[0.03] p-3">
                  <p className="text-[11px] font-semibold text-white/58">{item.label}</p>
                  <p className="mt-1 text-sm font-bold text-white/92">{item.value}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="mx-auto w-full max-w-md rounded-[30px] border border-white/12 bg-[rgba(24,20,16,0.78)] px-6 py-7 shadow-2xl backdrop-blur-md sm:px-7">
            <span className="inline-flex rounded-full border border-[#ff67006a] bg-[#ff670021] px-2.5 py-1 text-[10px] font-bold tracking-wide text-[#ff8e3b]">
              LOGIN / SIGNUP
            </span>

            <h1 className="mt-4 text-2xl font-extrabold leading-tight text-white sm:text-[1.75rem]">
              소셜 계정으로
              <br />
              투표 지도 시작하기
            </h1>

            <p className="mt-3 text-sm leading-relaxed text-white/70">
              Google 로그인 후 신규 사용자는 가입 완료(닉네임/출생연도/성별) 단계가 한 번 필요합니다.
              가입 완료 전에도 지도와 결과 탐색은 바로 가능합니다.
            </p>

            <button
              type="button"
              aria-label="Google로 계속하기"
              onClick={handleSocialLogin}
              disabled={pendingProvider !== null || isLoading}
              className="mt-7 flex w-full items-center justify-center gap-3 rounded-2xl border border-white/20 bg-white px-5 py-3.5 text-sm font-bold text-[#1f2937] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <span
                aria-hidden
                className="inline-grid h-5 w-5 grid-cols-2 grid-rows-2 overflow-hidden rounded-full border border-slate-300"
              >
                <span className="bg-[#ea4335]" />
                <span className="bg-[#4285f4]" />
                <span className="bg-[#fbbc05]" />
                <span className="bg-[#34a853]" />
              </span>
              {pendingProvider === 'google' || isLoading ? '로그인 준비 중...' : 'Google로 계속하기'}
            </button>

            <button
              type="button"
              aria-label="Apple 로그인 출시 예정"
              disabled
              className="mt-3 flex w-full cursor-not-allowed items-center justify-center gap-3 rounded-2xl border border-white/15 bg-white/5 px-5 py-3.5 text-sm font-bold text-white/55 opacity-80"
            >
              <span aria-hidden className="text-base leading-none text-white/70">
                
              </span>
              Apple 로그인 (출시 예정)
            </button>

            {authError ? (
              <p className="mt-3 rounded-lg border border-red-400/35 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {authError}
              </p>
            ) : null}

            <p className="mt-4 text-center text-xs text-white/55">약관 동의는 가입 완료 단계에서 필수로 진행됩니다.</p>
          </article>
        </section>
      </div>
    </main>
  );
}
