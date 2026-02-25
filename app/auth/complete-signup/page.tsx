'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { useAuth } from '@/contexts/AuthContext';
import { normalizeInternalRedirectPath } from '@/lib/auth/redirect';

const displayFont = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
});

const GENDER_OPTIONS: Array<{ value: 'male' | 'female'; label: string }> = [
  { value: 'male', label: '남성' },
  { value: 'female', label: '여성' },
];

function SelectChevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 6.5L8 10L12 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function CompleteSignupPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, requiresSignupCompletion, completeSignup } = useAuth();

  const [nickname, setNickname] = useState('');
  const [birthYear, setBirthYear] = useState<number>(() => new Date().getFullYear() - 17);
  const [gender, setGender] = useState<'male' | 'female' | ''>('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const nextPath = useMemo(() => {
    if (typeof window === 'undefined') {
      return '/';
    }
    const params = new URLSearchParams(window.location.search);
    return normalizeInternalRedirectPath(params.get('next'));
  }, []);

  const birthYearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const options: number[] = [];
    for (let year = currentYear; year >= 1900; year -= 1) {
      options.push(year);
    }
    return options;
  }, []);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (!isAuthenticated) {
      if (nextPath === '/') {
        router.replace('/auth');
      } else {
        router.replace(`/auth?next=${encodeURIComponent(nextPath)}`);
      }
      return;
    }

    if (!requiresSignupCompletion) {
      router.replace(nextPath);
    }
  }, [isAuthenticated, isLoading, nextPath, requiresSignupCompletion, router]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!nickname.trim()) {
      setErrorMessage('닉네임을 입력해 주세요.');
      return;
    }
    if (gender !== 'male' && gender !== 'female') {
      setErrorMessage('성별을 선택해 주세요.');
      return;
    }
    if (!agreedToTerms) {
      setErrorMessage('약관 동의가 필요합니다.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    const { error } = await completeSignup({
      nickname: nickname.trim(),
      birthYear,
      gender,
      agreedToTerms: true,
    });

    if (error) {
      setErrorMessage(error);
      setIsSubmitting(false);
      return;
    }

    router.replace(nextPath);
  };

  if (isLoading || !isAuthenticated || !requiresSignupCompletion) {
    return (
      <main className={`${displayFont.className} flex h-screen items-center justify-center bg-[#181410] text-white`}>
        <p className="text-sm text-white/70">회원가입 정보를 확인하는 중...</p>
      </main>
    );
  }

  const isFormReady = nickname.trim().length > 0 && (gender === 'male' || gender === 'female') && agreedToTerms;

  return (
    <main className={`${displayFont.className} relative min-h-screen overflow-hidden bg-[#181410] text-white`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_70%_at_20%_15%,rgba(47,116,255,0.24),rgba(47,116,255,0)_60%),radial-gradient(80%_60%_at_80%_90%,rgba(255,103,0,0.18),rgba(255,103,0,0)_65%),linear-gradient(to_bottom,rgba(19,15,12,0.95),rgba(19,15,12,0.82))]" />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-xl items-center px-4 py-8 sm:px-6">
        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="w-full rounded-[30px] border border-white/12 bg-[rgba(24,20,16,0.82)] px-6 py-7 shadow-2xl backdrop-blur-md sm:px-7"
        >
          <h1 className="text-2xl font-extrabold leading-tight text-white sm:text-[1.75rem]">
            가입을 완료하고
            <br />
            지역 비교 투표 시작하기
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-white/70">
            닉네임, 출생연도, 성별을 입력하고 약관에 동의하면 회원가입이 완료됩니다.
          </p>

          <label className="mt-6 block">
            <span className="mb-1 block text-xs font-semibold text-white/70">닉네임</span>
            <input
              value={nickname}
              onChange={(event) => {
                setNickname(event.target.value);
                setErrorMessage(null);
              }}
              placeholder="닉네임 입력"
              maxLength={20}
              className="h-11 w-full rounded-xl border border-white/14 bg-white/8 px-3 text-sm text-white outline-none placeholder:text-white/45 transition focus:border-[#ff9f0a66]"
            />
          </label>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-white/70">출생연도</span>
              <div className="relative">
                <select
                  value={String(birthYear)}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next)) {
                      setBirthYear(next);
                    }
                    setErrorMessage(null);
                  }}
                  className="h-11 w-full appearance-none rounded-xl border border-white/14 bg-white/8 px-3 pr-10 text-sm text-white outline-none transition focus:border-[#ff9f0a66] focus:ring-2 focus:ring-[#ff9f0a33]"
                >
                  {birthYearOptions.map((year) => (
                    <option key={year} value={year} className="bg-[#1f1f24] text-white">
                      {year}년
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-white/55">
                  <SelectChevron />
                </span>
              </div>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-white/70">성별</span>
              <div className="relative">
                <select
                  value={gender}
                  onChange={(event) => {
                    const next = event.target.value;
                    setGender(next === 'male' || next === 'female' ? next : '');
                    setErrorMessage(null);
                  }}
                  className="h-11 w-full appearance-none rounded-xl border border-white/14 bg-white/8 px-3 pr-10 text-sm text-white outline-none transition focus:border-[#ff9f0a66] focus:ring-2 focus:ring-[#ff9f0a33]"
                >
                  <option value="" className="bg-[#1f1f24] text-white/80">
                    성별 선택
                  </option>
                  {GENDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} className="bg-[#1f1f24] text-white">
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-white/55">
                  <SelectChevron />
                </span>
              </div>
            </label>
          </div>

          <label className="mt-4 flex items-start gap-2 rounded-xl border border-white/12 bg-white/[0.03] px-3 py-2.5">
            <input
              type="checkbox"
              checked={agreedToTerms}
              onChange={(event) => {
                setAgreedToTerms(event.target.checked);
                setErrorMessage(null);
              }}
              className="mt-0.5 h-4 w-4 accent-[#ff9f0a]"
            />
            <span className="text-xs leading-relaxed text-white/72">이용약관 및 개인정보처리방침 내용을 확인했고 동의합니다.</span>
          </label>

          {errorMessage ? (
            <p className="mt-3 rounded-lg border border-red-400/35 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {errorMessage}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting || !isFormReady}
            className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-2xl border border-[#ff9f0a66] bg-[#ff6b00] text-[15px] font-bold text-white shadow-[0_8px_24px_rgba(255,107,0,0.35)] transition hover:bg-[#ff7b1d] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? '처리 중...' : '가입 완료'}
          </button>
        </form>
      </div>
    </main>
  );
}
