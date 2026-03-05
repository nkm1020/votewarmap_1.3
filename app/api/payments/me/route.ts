import { NextResponse } from 'next/server';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import {
  amountMinorToMajor,
  getSupporterEntitlementKey,
  isPaymentsEnabled,
  normalizePaymentOrderStatus,
  type SupportProductRow,
} from '@/lib/server/payments';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type EntitlementRow = {
  granted_at: string;
  revoked_at: string | null;
};

type PaymentOrderRow = {
  id: string;
  product_id: string;
  provider: string;
  payment_method: 'CARD' | 'PAYPAL';
  currency: 'KRW' | 'USD';
  amount_minor: number;
  status: string;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  refunded_at: string | null;
  canceled_at: string | null;
  expired_at: string | null;
};

export async function GET(request: Request) {
  try {
    if (!isPaymentsEnabled()) {
      return NextResponse.json({ error: '결제 기능이 비활성화되어 있습니다.' }, { status: 503 });
    }

    const user = await resolveUserFromAuthorizationHeader(request.headers.get('authorization'));
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const supabase = getSupabaseServiceRoleClient();

    const [entitlementResult, ordersResult] = await Promise.all([
      supabase
        .from('user_entitlements')
        .select('granted_at, revoked_at')
        .eq('user_id', user.id)
        .eq('entitlement_key', getSupporterEntitlementKey())
        .maybeSingle(),
      supabase
        .from('payment_orders')
        .select(
          'id, product_id, provider, payment_method, currency, amount_minor, status, created_at, updated_at, confirmed_at, refunded_at, canceled_at, expired_at',
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);

    if (entitlementResult.error) {
      return NextResponse.json({ error: entitlementResult.error.message }, { status: 500 });
    }

    if (ordersResult.error) {
      return NextResponse.json({ error: ordersResult.error.message }, { status: 500 });
    }

    const orders = (ordersResult.data ?? []) as PaymentOrderRow[];
    const productIds = Array.from(new Set(orders.map((item) => item.product_id).filter((item) => item.length > 0)));

    const productsResult =
      productIds.length > 0
        ? await supabase
            .from('support_products')
            .select('id, title, currency, amount_minor, payment_method, is_active, sort_order')
            .in('id', productIds)
        : { data: [], error: null };

    if (productsResult.error) {
      return NextResponse.json({ error: productsResult.error.message }, { status: 500 });
    }

    const productMap = new Map<string, SupportProductRow>();
    ((productsResult.data ?? []) as SupportProductRow[]).forEach((item) => {
      productMap.set(item.id, item);
    });

    const entitlement = entitlementResult.data as EntitlementRow | null;

    return NextResponse.json({
      hasSupporterBadge: Boolean(entitlement && !entitlement.revoked_at),
      badgeGrantedAt: entitlement?.revoked_at ? null : entitlement?.granted_at ?? null,
      orders: orders.map((order) => {
        const product = productMap.get(order.product_id);
        return {
          id: order.id,
          provider: order.provider,
          paymentMethod: order.payment_method,
          currency: order.currency,
          amountMinor: order.amount_minor,
          amount: amountMinorToMajor(order.currency, order.amount_minor),
          status: normalizePaymentOrderStatus(order.status),
          title: product?.title ?? '후원 결제',
          createdAt: order.created_at,
          updatedAt: order.updated_at,
          confirmedAt: order.confirmed_at,
          refundedAt: order.refunded_at,
          canceledAt: order.canceled_at,
          expiredAt: order.expired_at,
        };
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'payment me fetch failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
