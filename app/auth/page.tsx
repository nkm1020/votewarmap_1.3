'use client';

import Link from 'next/link';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const displayFont = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
});

export default function AuthPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, signInWithGoogle, signInWithKakao } = useAuth();
  const [pendingProvider, setPendingProvider] = useState<'google' | 'kakao' | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/');
    }
  }, [isAuthenticated, isLoading, router]);

  const handleSocialLogin = async (provider: 'google' | 'kakao') => {
    setAuthError(null);
    setPendingProvider(provider);

    const { error } = provider === 'google' ? await signInWithGoogle() : await signInWithKakao();
    if (error) {
      setAuthError(error);
      setPendingProvider(null);
    }
  };

  return (
    <main className={`${displayFont.className} relative h-screen w-full overflow-hidden bg-[#181410] text-white`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_70%_at_20%_15%,rgba(47,116,255,0.24),rgba(47,116,255,0)_60%),radial-gradient(80%_60%_at_80%_90%,rgba(255,103,0,0.18),rgba(255,103,0,0)_65%),linear-gradient(to_bottom,rgba(19,15,12,0.95),rgba(19,15,12,0.82))]" />
      <div className="pointer-events-none absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-25 mix-blend-overlay" />

      <div className="relative z-10 mx-auto flex h-full w-full max-w-6xl flex-col px-4 pb-8 pt-5 sm:px-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#ff8e3b]">Vote War Map</p>
            <p className="text-sm font-bold text-white/95">대한민국 실시간 투표 지도</p>
          </div>
          <Link
            href="/"
            className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            홈으로
          </Link>
        </header>

        <section className="mx-auto flex w-full max-w-md flex-1 items-center">
          <article className="w-full rounded-[30px] border border-white/12 bg-[rgba(24,20,16,0.78)] px-6 py-7 shadow-2xl backdrop-blur-md sm:px-7">
            <span className="inline-flex rounded-full border border-[#ff67006a] bg-[#ff670021] px-2.5 py-1 text-[10px] font-bold tracking-wide text-[#ff8e3b]">
              LOGIN / SIGNUP
            </span>

            <h1 className="mt-4 text-2xl font-extrabold leading-tight text-white sm:text-[1.75rem]">
              소셜 계정으로
              <br />
              투표 지도 시작하기
            </h1>

            <p className="mt-3 text-sm leading-relaxed text-white/70">
              로그인과 회원가입을 분리하지 않습니다. 소셜 계정으로 계속하면 기존 계정 로그인 또는 신규
              계정 생성이 자동으로 처리됩니다.
            </p>

            <button
              type="button"
              aria-label="Google로 계속하기"
              onClick={() => handleSocialLogin('google')}
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
              aria-label="카카오로 계속하기"
              onClick={() => handleSocialLogin('kakao')}
              disabled={pendingProvider !== null || isLoading}
              className="mt-3 flex w-full items-center justify-center gap-3 rounded-2xl border border-[#3d2f00] bg-[#fee500] px-5 py-3.5 text-sm font-bold text-[#191919] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <span
                aria-hidden
                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#191919] text-[11px] font-black text-[#fee500]"
              >
                K
              </span>
              {pendingProvider === 'kakao' || isLoading ? '로그인 준비 중...' : '카카오로 계속하기'}
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

            <p className="mt-4 text-center text-xs text-white/55">
              계속하면 이용약관 및 개인정보처리방침에 동의한 것으로 간주됩니다.
            </p>
          </article>
        </section>
      </div>
    </main>
  );
}
