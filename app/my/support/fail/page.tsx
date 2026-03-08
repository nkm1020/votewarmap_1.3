'use client';

import { Suspense, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTheme } from '@/contexts/ThemeContext';
import { getPageThemeTokens } from '@/lib/theme/pageTheme';

function SupportFailPageContent() {
  const searchParams = useSearchParams();
  const { resolvedTheme } = useTheme();
  const theme = getPageThemeTokens(resolvedTheme === 'dark');

  const details = useMemo(() => {
    const code = searchParams.get('code')?.trim() || 'UNKNOWN';
    const message = searchParams.get('message')?.trim() || '결제를 완료하지 못했습니다.';
    const orderId = searchParams.get('orderId')?.trim() || null;

    return {
      code,
      message,
      orderId,
    };
  }, [searchParams]);

  return (
    <main className={`${theme.shellClass} min-h-screen px-4 py-10 sm:px-6 lg:px-10`}>
      <section className={`${theme.elevatedClass} mx-auto w-full max-w-xl rounded-2xl border p-6 shadow-[var(--app-modal-shadow)]`}>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#ff8f8f]">Payment Failed</p>
        <h1 className={`mt-2 text-2xl font-bold ${theme.textPrimaryClass}`}>후원 결제가 취소되었거나 실패했습니다</h1>

        <div className="mt-4 space-y-2 rounded-xl border border-[#ff7a7a]/45 bg-[#ff7a7a]/12 p-4 text-sm">
          <p>
            오류 코드: <span className="font-semibold text-[#ffc3c3]">{details.code}</span>
          </p>
          <p className="text-[#ffc3c3]">{details.message}</p>
          {details.orderId ? <p className={theme.textSecondaryClass}>주문 ID: {details.orderId}</p> : null}
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/my/support"
            className="inline-flex h-10 items-center rounded-lg bg-[#FF5C00] px-4 text-sm font-semibold text-white transition hover:bg-[#ff7324]"
          >
            후원 다시 시도
          </Link>
          <Link
            href="/my"
            className={`${theme.surfaceSoftClass} inline-flex h-10 items-center rounded-lg border ${theme.borderClass} px-4 text-sm font-semibold ${theme.textPrimaryClass} transition hover:bg-[color:var(--app-surface-soft-strong)]`}
          >
            MY로 이동
          </Link>
        </div>
      </section>
    </main>
  );
}

function SupportFailPageFallback() {
  const { resolvedTheme } = useTheme();
  const theme = getPageThemeTokens(resolvedTheme === 'dark');

  return (
    <main className={`${theme.shellClass} min-h-screen px-4 py-10 sm:px-6 lg:px-10`}>
      <section className={`${theme.elevatedClass} mx-auto w-full max-w-xl rounded-2xl border p-6 shadow-[var(--app-modal-shadow)]`}>
        <p className={`text-sm ${theme.textSecondaryClass}`}>결제 결과를 불러오는 중입니다...</p>
      </section>
    </main>
  );
}

export default function SupportFailPage() {
  return (
    <Suspense fallback={<SupportFailPageFallback />}>
      <SupportFailPageContent />
    </Suspense>
  );
}
