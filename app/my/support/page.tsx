'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

type Currency = 'KRW' | 'USD';
type PaymentMethod = 'CARD' | 'PAYPAL';

type Product = {
  id: string;
  title: string;
  currency: Currency;
  paymentMethod: PaymentMethod;
  amountMinor: number;
  amount: number;
  sortOrder: number;
};

type PaymentsProductsResponse = {
  enabled: boolean;
  recommended: {
    countryCode: string;
    currency: Currency;
    paymentMethod: PaymentMethod;
  };
  products: Product[];
  grouped: Record<Currency, Product[]>;
};

type PaymentsMeResponse = {
  hasSupporterBadge: boolean;
  badgeGrantedAt: string | null;
  orders: Array<{
    id: string;
    provider: string;
    paymentMethod: PaymentMethod;
    currency: Currency;
    amountMinor: number;
    amount: number;
    status: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    confirmedAt: string | null;
    refundedAt: string | null;
    canceledAt: string | null;
    expiredAt: string | null;
  }>;
};

type CreateOrderResponse = {
  orderId: string;
  orderName: string;
  amount: number;
  currency: Currency;
  paymentMethod: PaymentMethod;
  checkoutPayload: {
    method: 'CARD' | 'FOREIGN_EASY_PAY';
    amount: {
      currency: Currency;
      value: number;
    };
    orderId: string;
    orderName: string;
    successUrl: string;
    failUrl: string;
    customerEmail?: string;
    customerName?: string;
    easyPay?: 'PAYPAL';
  };
};

type PaymentInstance = {
  requestPayment: (args: Record<string, unknown>) => Promise<void>;
};

type TossPaymentsFactory = (clientKey: string) => {
  payment: (args: { customerKey: string }) => PaymentInstance;
};

declare global {
  interface Window {
    TossPayments?: TossPaymentsFactory;
  }
}

const TOSS_SCRIPT_URL = 'https://js.tosspayments.com/v2/standard';

function formatAmount(currency: Currency, amount: number): string {
  if (currency === 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

async function loadTossPaymentsFactory(): Promise<TossPaymentsFactory> {
  if (typeof window === 'undefined') {
    throw new Error('브라우저 환경에서만 결제를 시작할 수 있습니다.');
  }

  if (window.TossPayments) {
    return window.TossPayments;
  }

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${TOSS_SCRIPT_URL}"]`) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('결제 SDK 로드에 실패했습니다.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = TOSS_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('결제 SDK 로드에 실패했습니다.'));
    document.head.appendChild(script);
  });

  if (!window.TossPayments) {
    throw new Error('결제 SDK를 찾을 수 없습니다.');
  }

  return window.TossPayments;
}

function SupportBadge({ hasBadge, grantedAt }: { hasBadge: boolean; grantedAt: string | null }) {
  if (!hasBadge) {
    return (
      <p className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white/80">
        아직 후원자 배지가 없습니다. 첫 후원 완료 시 즉시 배지가 지급됩니다.
      </p>
    );
  }

  return (
    <p className="rounded-xl border border-[#ffcf66]/60 bg-[#ffb800]/18 px-4 py-3 text-sm font-semibold text-[#ffe49f]">
      ★ 후원자 배지 보유 중
      {grantedAt ? <span className="ml-2 text-[12px] font-medium text-[#ffe49f]/80">({formatDateTime(grantedAt)} 획득)</span> : null}
    </p>
  );
}

export default function MySupportPage() {
  const router = useRouter();
  const { isLoading, isAuthenticated, user } = useAuth();
  const [productsState, setProductsState] = useState<PaymentsProductsResponse | null>(null);
  const [meState, setMeState] = useState<PaymentsMeResponse | null>(null);
  const [isFetching, setIsFetching] = useState(true);
  const [isPayingProductId, setIsPayingProductId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPageData = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError('인증 클라이언트를 초기화하지 못했습니다.');
      setIsFetching(false);
      return;
    }

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? null;
    if (!token) {
      setError('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
      setIsFetching(false);
      return;
    }

    const headers = {
      Authorization: `Bearer ${token}`,
    };

    const [productsResponse, meResponse] = await Promise.all([
      fetch('/api/payments/products', { headers }),
      fetch('/api/payments/me', { headers }),
    ]);

    const productsJson = (await productsResponse.json()) as PaymentsProductsResponse & { error?: string };
    const meJson = (await meResponse.json()) as PaymentsMeResponse & { error?: string };

    if (!productsResponse.ok) {
      throw new Error(productsJson.error ?? '후원 상품을 불러오지 못했습니다.');
    }

    if (!meResponse.ok) {
      throw new Error(meJson.error ?? '내 결제 정보를 불러오지 못했습니다.');
    }

    setProductsState(productsJson);
    setMeState(meJson);
    setError(null);
    setIsFetching(false);
  }, []);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (!isAuthenticated) {
      router.replace('/auth?redirect=%2Fmy%2Fsupport');
      return;
    }

    void loadPageData();
  }, [isLoading, isAuthenticated, loadPageData, router]);

  const sortedProducts = useMemo(() => {
    if (!productsState) {
      return [] as Product[];
    }
    return [...productsState.products].sort((a, b) => {
      if (a.currency !== b.currency) {
        return a.currency.localeCompare(b.currency);
      }
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      return a.amountMinor - b.amountMinor;
    });
  }, [productsState]);

  const onPay = useCallback(
    async (productId: string) => {
      if (!productsState?.enabled) {
        setError('결제 기능이 비활성화되어 있습니다.');
        return;
      }

      const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim();
      if (!clientKey) {
        setError('결제 키가 설정되지 않았습니다. 운영자에게 문의해 주세요.');
        return;
      }

      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setError('인증 클라이언트를 초기화하지 못했습니다.');
        return;
      }

      setIsPayingProductId(productId);
      setError(null);

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token ?? null;
        if (!token) {
          throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
        }

        const orderResponse = await fetch('/api/payments/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ productId }),
        });

        const orderJson = (await orderResponse.json()) as CreateOrderResponse & { error?: string };
        if (!orderResponse.ok) {
          throw new Error(orderJson.error ?? '주문 생성에 실패했습니다.');
        }

        const TossPayments = await loadTossPaymentsFactory();
        const paymentClient = TossPayments(clientKey).payment({
          customerKey: `user_${user?.id ?? 'anonymous'}`,
        });

        const checkoutPayload = orderJson.checkoutPayload;
        await paymentClient.requestPayment({
          method: checkoutPayload.method,
          amount: checkoutPayload.amount,
          orderId: checkoutPayload.orderId,
          orderName: checkoutPayload.orderName,
          successUrl: checkoutPayload.successUrl,
          failUrl: checkoutPayload.failUrl,
          customerEmail: checkoutPayload.customerEmail,
          customerName: checkoutPayload.customerName,
          ...(checkoutPayload.easyPay ? { easyPay: checkoutPayload.easyPay } : {}),
        });
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : '결제를 진행하지 못했습니다.';
        setError(message);
        setIsPayingProductId(null);
      }
    },
    [productsState?.enabled, user?.id],
  );

  return (
    <main className="min-h-screen bg-[#070d16] px-4 py-10 text-white sm:px-6 lg:px-10">
      <section className="mx-auto w-full max-w-4xl space-y-6">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#ff9f0a]">Support</p>
            <h1 className="mt-2 text-3xl font-extrabold">VoteWarMap 후원하기</h1>
            <p className="mt-2 text-sm text-white/70">1회 후원 결제로 서비스 운영에 힘을 보태주세요.</p>
          </div>
          <Link
            href="/my"
            className="inline-flex h-10 items-center rounded-xl border border-white/20 bg-white/5 px-3 text-sm font-semibold text-white/90 transition hover:bg-white/10"
          >
            MY로 돌아가기
          </Link>
        </header>

        {error ? (
          <p className="rounded-xl border border-[#ff7a7a]/45 bg-[#ff7a7a]/12 px-4 py-3 text-sm text-[#ffc3c3]">{error}</p>
        ) : null}

        {meState ? <SupportBadge hasBadge={meState.hasSupporterBadge} grantedAt={meState.badgeGrantedAt} /> : null}

        <section className="rounded-2xl border border-white/12 bg-[rgba(12,18,28,0.86)] p-4 sm:p-6">
          <h2 className="text-lg font-bold">후원 티어</h2>
          <p className="mt-1 text-sm text-white/70">KRW 카드 결제와 USD PayPal 결제를 지원합니다.</p>

          {isFetching ? (
            <p className="mt-5 text-sm text-white/65">후원 상품을 불러오는 중...</p>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {sortedProducts.map((product) => {
                const isPaying = isPayingProductId === product.id;
                const isRecommended =
                  productsState?.recommended.currency === product.currency &&
                  productsState?.recommended.paymentMethod === product.paymentMethod;

                return (
                  <article
                    key={product.id}
                    className="rounded-xl border border-white/12 bg-white/5 p-4 shadow-[0_10px_22px_rgba(0,0,0,0.18)]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-[16px] font-bold">{product.title}</h3>
                      {isRecommended ? (
                        <span className="rounded-full bg-[#ff9f0a]/18 px-2.5 py-1 text-[11px] font-semibold text-[#ffc56a]">
                          추천 결제
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xl font-extrabold">{formatAmount(product.currency, product.amount)}</p>
                    <p className="mt-1 text-xs text-white/70">
                      {product.currency} · {product.paymentMethod === 'CARD' ? '카드' : 'PayPal'}
                    </p>

                    <button
                      type="button"
                      disabled={isPayingProductId !== null}
                      onClick={() => {
                        void onPay(product.id);
                      }}
                      className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg bg-[#FF5C00] px-3 text-sm font-semibold text-white transition hover:bg-[#ff7324] disabled:cursor-not-allowed disabled:bg-[#6c3d23]"
                    >
                      {isPaying ? '결제창 여는 중...' : '후원 결제하기'}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {meState ? (
          <section className="rounded-2xl border border-white/12 bg-[rgba(12,18,28,0.78)] p-4 sm:p-6">
            <h2 className="text-lg font-bold">최근 후원 내역</h2>
            {meState.orders.length === 0 ? (
              <p className="mt-2 text-sm text-white/70">아직 후원 결제 내역이 없습니다.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {meState.orders.slice(0, 8).map((order) => (
                  <li
                    key={order.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-semibold">{order.title}</p>
                      <p className="text-[12px] text-white/65">{formatDateTime(order.createdAt)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatAmount(order.currency, order.amount)}</p>
                      <p className="text-[12px] text-white/65">{order.status}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </section>
    </main>
  );
}
