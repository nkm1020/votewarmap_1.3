import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import {
  assertAmountMatches,
  confirmTossPayment,
  mapTossStatusToOrderStatus,
  normalizePaymentOrderStatus,
  isPaymentsEnabled,
  type PaymentOrderStatus,
} from '@/lib/server/payments';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const bodySchema = z.object({
  paymentKey: z.string().min(1),
  orderId: z.string().min(1),
  amount: z.number().positive(),
});

type PaymentOrderRow = {
  id: string;
  user_id: string;
  currency: 'KRW' | 'USD';
  amount_minor: number;
  status: string;
  provider_payment_key: string | null;
  confirmed_at: string | null;
  refunded_at: string | null;
  canceled_at: string | null;
  expired_at: string | null;
  updated_at: string;
};

function buildStatusTimestampPatch(status: PaymentOrderStatus): Record<string, string | null> {
  const now = new Date().toISOString();
  switch (status) {
    case 'CONFIRMED':
      return {
        confirmed_at: now,
        canceled_at: null,
        refunded_at: null,
        expired_at: null,
      };
    case 'REFUNDED':
      return {
        refunded_at: now,
      };
    case 'CANCELED':
      return {
        canceled_at: now,
      };
    case 'EXPIRED':
      return {
        expired_at: now,
      };
    default:
      return {};
  }
}

function resolveEntitlementFromRpcResponse(rows: unknown): { hasSupporterBadge: boolean; grantedAt: string | null } {
  const list = Array.isArray(rows) ? rows : [];
  const first = list[0] as { has_supporter_badge?: unknown; granted_at?: unknown } | undefined;
  if (!first) {
    return { hasSupporterBadge: false, grantedAt: null };
  }

  return {
    hasSupporterBadge: Boolean(first.has_supporter_badge),
    grantedAt: typeof first.granted_at === 'string' ? first.granted_at : null,
  };
}

export async function POST(request: Request) {
  try {
    if (!isPaymentsEnabled()) {
      return NextResponse.json({ error: '결제 기능이 비활성화되어 있습니다.' }, { status: 503 });
    }

    const user = await resolveUserFromAuthorizationHeader(request.headers.get('authorization'));
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const rawBody = (await request.json()) as unknown;
    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '잘못된 요청 형식입니다.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const supabase = getSupabaseServiceRoleClient();

    const { data: orderRow, error: orderError } = await supabase
      .from('payment_orders')
      .select('id, user_id, currency, amount_minor, status, provider_payment_key, confirmed_at, refunded_at, canceled_at, expired_at, updated_at')
      .eq('provider_order_id', parsed.data.orderId)
      .maybeSingle();

    if (orderError) {
      return NextResponse.json({ error: orderError.message }, { status: 500 });
    }

    if (!orderRow) {
      return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });
    }

    const order = orderRow as PaymentOrderRow;
    if (order.user_id !== user.id) {
      return NextResponse.json({ error: '해당 주문에 접근할 수 없습니다.' }, { status: 403 });
    }

    const currentStatus = normalizePaymentOrderStatus(order.status);
    if (currentStatus === 'CONFIRMED' && order.provider_payment_key === parsed.data.paymentKey) {
      const { data: entitlementRows, error: entitlementError } = await supabase.rpc('recompute_supporter_entitlement', {
        p_user_id: user.id,
      });

      if (entitlementError) {
        return NextResponse.json({ error: entitlementError.message }, { status: 500 });
      }

      return NextResponse.json({
        order: {
          id: order.id,
          status: currentStatus,
          updatedAt: order.updated_at,
        },
        entitlement: resolveEntitlementFromRpcResponse(entitlementRows),
      });
    }

    if (currentStatus !== 'PENDING') {
      return NextResponse.json({ error: '이미 처리된 주문입니다.' }, { status: 409 });
    }

    if (!assertAmountMatches(order.currency, order.amount_minor, parsed.data.amount)) {
      return NextResponse.json({ error: '주문 금액이 일치하지 않습니다.' }, { status: 400 });
    }

    const confirmResult = await confirmTossPayment({
      paymentKey: parsed.data.paymentKey,
      orderId: parsed.data.orderId,
      amount: parsed.data.amount,
    });

    if (!confirmResult.ok) {
      const { error: failUpdateError } = await supabase
        .from('payment_orders')
        .update({
          provider_payment_key: parsed.data.paymentKey,
          status: 'FAILED',
          failure_code: confirmResult.errorCode,
          failure_message: confirmResult.message,
          raw_last_payload: confirmResult.payload,
        })
        .eq('id', order.id);

      if (failUpdateError) {
        return NextResponse.json({ error: failUpdateError.message }, { status: 500 });
      }

      return NextResponse.json(
        {
          error: confirmResult.message,
          code: confirmResult.errorCode,
        },
        { status: 400 },
      );
    }

    const mappedStatus = mapTossStatusToOrderStatus(confirmResult.payload.status);
    const updatePatch: Record<string, unknown> = {
      provider_payment_key: confirmResult.payload.paymentKey ?? parsed.data.paymentKey,
      status: mappedStatus,
      failure_code: null,
      failure_message: null,
      raw_last_payload: confirmResult.payload,
      ...buildStatusTimestampPatch(mappedStatus),
    };

    const { data: updatedOrderRows, error: updateError } = await supabase
      .from('payment_orders')
      .update(updatePatch)
      .eq('id', order.id)
      .select('id, status, updated_at')
      .limit(1);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const { data: entitlementRows, error: entitlementError } = await supabase.rpc('recompute_supporter_entitlement', {
      p_user_id: user.id,
    });

    if (entitlementError) {
      return NextResponse.json({ error: entitlementError.message }, { status: 500 });
    }

    const updatedOrder = Array.isArray(updatedOrderRows) ? updatedOrderRows[0] : null;

    return NextResponse.json({
      order: {
        id: updatedOrder?.id ?? order.id,
        status: typeof updatedOrder?.status === 'string' ? updatedOrder.status : mappedStatus,
        updatedAt:
          typeof updatedOrder?.updated_at === 'string'
            ? updatedOrder.updated_at
            : new Date().toISOString(),
      },
      entitlement: resolveEntitlementFromRpcResponse(entitlementRows),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'payment confirm failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
