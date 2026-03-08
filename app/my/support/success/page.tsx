'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { getPageThemeTokens } from '@/lib/theme/pageTheme';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type ConfirmResponse = {
  order: {
    id: string;
    status: string;
    updatedAt: string;
  };
  entitlement: {
    hasSupporterBadge: boolean;
    grantedAt: string | null;
  };
  error?: string;
};

type Phase = 'confirming' | 'success' | 'failed';

function formatDateTime(value: string | null): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function SupportSuccessPageContent() {
  const { isLoading, isAuthenticated } = useAuth();
  const { resolvedTheme } = useTheme();
  const theme = getPageThemeTokens(resolvedTheme === 'dark');
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasRequestedRef = useRef(false);
  const [phase, setPhase] = useState<Phase>('confirming');
  const [error, setError] = useState<string | null>(null);
  const [entitlement, setEntitlement] = useState<{ hasSupporterBadge: boolean; grantedAt: string | null } | null>(null);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);

  const payload = useMemo(() => {
    const paymentKey = searchParams.get('paymentKey')?.trim() ?? '';
    const orderId = searchParams.get('orderId')?.trim() ?? '';
    const amountRaw = searchParams.get('amount')?.trim() ?? '';
    const amount = Number(amountRaw);

    return {
      paymentKey,
      orderId,
      amount,
      isValid: paymentKey.length > 0 && orderId.length > 0 && Number.isFinite(amount) && amount > 0,
    };
  }, [searchParams]);
  const invalidPayloadError = payload.isValid ? null : '결제 승인 파라미터가 올바르지 않습니다.';

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (!isAuthenticated) {
      router.replace('/auth?redirect=%2Fmy%2Fsupport%2Fsuccess');
      return;
    }

    if (hasRequestedRef.current) {
      return;
    }

    hasRequestedRef.current = true;

    if (invalidPayloadError) {
      return;
    }

    const run = async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        throw new Error('인증 클라이언트를 초기화하지 못했습니다.');
      }

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (!token) {
        throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
      }

      const response = await fetch('/api/payments/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          paymentKey: payload.paymentKey,
          orderId: payload.orderId,
          amount: payload.amount,
        }),
      });

      const json = (await response.json()) as ConfirmResponse;
      if (!response.ok) {
        throw new Error(json.error ?? '결제 승인에 실패했습니다.');
      }

      setEntitlement(json.entitlement);
      setOrderStatus(json.order.status);
      setPhase('success');
    };

    void run().catch((runError: unknown) => {
      const message = runError instanceof Error ? runError.message : '결제 승인 처리 중 오류가 발생했습니다.';
      setError(message);
      setPhase('failed');
    });
  }, [invalidPayloadError, isLoading, isAuthenticated, payload, router]);

  const effectivePhase: Phase = invalidPayloadError ? 'failed' : phase;
  const effectiveError = invalidPayloadError ?? error;

  return (
    <main className={`${theme.shellClass} min-h-screen px-4 py-10 sm:px-6 lg:px-10`}>
      <section className={`${theme.elevatedClass} mx-auto w-full max-w-xl rounded-2xl border p-6 shadow-[var(--app-modal-shadow)]`}>
        {effectivePhase === 'confirming' ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#ff9f0a]">Payment</p>
            <h1 className={`mt-2 text-2xl font-bold ${theme.textPrimaryClass}`}>결제 승인 처리 중...</h1>
            <p className={`mt-3 text-sm ${theme.textSecondaryClass}`}>잠시만 기다려 주세요. 후원 내역을 확인하고 있습니다.</p>
          </>
        ) : null}

        {effectivePhase === 'success' ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8af5a0]">Completed</p>
            <h1 className={`mt-2 text-2xl font-bold ${theme.textPrimaryClass}`}>후원이 완료되었습니다</h1>
            <p className={`mt-3 text-sm ${theme.textSecondaryClass}`}>덕분에 VoteWarMap 운영에 큰 힘이 됩니다.</p>

            <div className={`${theme.surfaceSoftClass} mt-5 space-y-2 rounded-xl border ${theme.borderSoftClass} p-4 text-sm`}>
              <p className={theme.textPrimaryClass}>
                주문 상태: <span className="font-semibold text-[#a7f3b5]">{orderStatus}</span>
              </p>
              <p className={theme.textPrimaryClass}>
                후원자 배지: {entitlement?.hasSupporterBadge ? '지급 완료' : '미지급'}
                {entitlement?.grantedAt ? (
                  <span className={`ml-1 ${theme.textMutedClass}`}>({formatDateTime(entitlement.grantedAt)})</span>
                ) : null}
              </p>
            </div>
          </>
        ) : null}

        {effectivePhase === 'failed' ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#ff8f8f]">Failed</p>
            <h1 className={`mt-2 text-2xl font-bold ${theme.textPrimaryClass}`}>결제 승인에 실패했습니다</h1>
            <p className="mt-3 rounded-xl border border-[#ff7a7a]/45 bg-[#ff7a7a]/12 px-3 py-2 text-sm text-[#ffc3c3]">
              {effectiveError ?? '결제를 완료하지 못했습니다. 다시 시도해 주세요.'}
            </p>
          </>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/my/support"
            className="inline-flex h-10 items-center rounded-lg bg-[#FF5C00] px-4 text-sm font-semibold text-white transition hover:bg-[#ff7324]"
          >
            후원 페이지로 이동
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

function SupportSuccessPageFallback() {
  const { resolvedTheme } = useTheme();
  const theme = getPageThemeTokens(resolvedTheme === 'dark');

  return (
    <main className={`${theme.shellClass} min-h-screen px-4 py-10 sm:px-6 lg:px-10`}>
      <section className={`${theme.elevatedClass} mx-auto w-full max-w-xl rounded-2xl border p-6 shadow-[var(--app-modal-shadow)]`}>
        <p className={`text-sm ${theme.textSecondaryClass}`}>결제 승인 정보를 확인하는 중입니다...</p>
      </section>
    </main>
  );
}

export default function SupportSuccessPage() {
  return (
    <Suspense fallback={<SupportSuccessPageFallback />}>
      <SupportSuccessPageContent />
    </Suspense>
  );
}
