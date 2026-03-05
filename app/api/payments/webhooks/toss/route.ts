import { NextResponse } from 'next/server';
import {
  calculatePayloadHash,
  extractTossWebhookCore,
  fetchTossPaymentByKey,
  mapTossStatusToOrderStatus,
  normalizePaymentOrderStatus,
  isPaymentsEnabled,
  type PaymentOrderStatus,
  type TossPayment,
} from '@/lib/server/payments';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type PaymentOrderRow = {
  id: string;
  user_id: string;
  provider_order_id: string;
  provider_payment_key: string | null;
  status: string;
};

function shouldTransitionStatus(current: PaymentOrderStatus, incoming: PaymentOrderStatus): boolean {
  if (incoming === 'PENDING') {
    return false;
  }
  if (current === incoming) {
    return false;
  }

  if (current === 'REFUNDED' || current === 'CANCELED' || current === 'EXPIRED') {
    return false;
  }

  if (current === 'CONFIRMED' && (incoming === 'FAILED' || incoming === 'EXPIRED')) {
    return false;
  }

  return true;
}

function buildStatusPatch(status: PaymentOrderStatus): Record<string, string | null> {
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

async function markWebhookProcessed(webhookId: string | null): Promise<void> {
  if (!webhookId) {
    return;
  }

  const supabase = getSupabaseServiceRoleClient();
  await supabase
    .from('payment_webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', webhookId);
}

function resolveStatusFromPayload(payload: TossPayment | null, fallbackStatus: string | null): PaymentOrderStatus {
  const statusRaw = payload?.status ?? fallbackStatus;
  return mapTossStatusToOrderStatus(statusRaw);
}

export async function POST(request: Request) {
  try {
    if (!isPaymentsEnabled()) {
      return NextResponse.json({ ok: false, error: 'payments_disabled' }, { status: 503 });
    }

    const rawPayload = await request.text();
    if (!rawPayload) {
      return NextResponse.json({ ok: false, error: 'empty_payload' }, { status: 400 });
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(rawPayload) as unknown;
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }

    const core = extractTossWebhookCore(parsedPayload);
    const payloadHash = calculatePayloadHash(rawPayload);

    const supabase = getSupabaseServiceRoleClient();

    const { data: webhookInsertRow, error: webhookInsertError } = await supabase
      .from('payment_webhook_events')
      .insert({
        provider: 'toss',
        event_type: core.eventType,
        provider_event_id: core.providerEventId,
        provider_payment_key: core.paymentKey,
        payload: parsedPayload,
        payload_hash: payloadHash,
      })
      .select('id')
      .maybeSingle();

    if (webhookInsertError) {
      if (webhookInsertError.code === '23505') {
        return NextResponse.json({ ok: true, duplicate: true });
      }
      return NextResponse.json({ ok: false, error: webhookInsertError.message }, { status: 500 });
    }

    const webhookId = typeof webhookInsertRow?.id === 'string' ? webhookInsertRow.id : null;

    let trustedPaymentPayload: TossPayment | null = null;
    if (core.paymentKey) {
      const tossPayment = await fetchTossPaymentByKey(core.paymentKey);
      if (tossPayment.ok) {
        trustedPaymentPayload = tossPayment.payload;
      }
    }

    const paymentKey = trustedPaymentPayload?.paymentKey ?? core.paymentKey;
    const providerOrderId = trustedPaymentPayload?.orderId ?? core.orderId;

    if (!paymentKey && !providerOrderId) {
      await markWebhookProcessed(webhookId);
      return NextResponse.json({ ok: true, skipped: true });
    }

    let orderRow: PaymentOrderRow | null = null;
    if (providerOrderId) {
      const { data, error } = await supabase
        .from('payment_orders')
        .select('id, user_id, provider_order_id, provider_payment_key, status')
        .eq('provider_order_id', providerOrderId)
        .maybeSingle();

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      orderRow = (data as PaymentOrderRow | null) ?? null;
    }

    if (!orderRow && paymentKey) {
      const { data, error } = await supabase
        .from('payment_orders')
        .select('id, user_id, provider_order_id, provider_payment_key, status')
        .eq('provider_payment_key', paymentKey)
        .maybeSingle();

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      orderRow = (data as PaymentOrderRow | null) ?? null;
    }

    if (!orderRow) {
      await markWebhookProcessed(webhookId);
      return NextResponse.json({ ok: true, skipped: true });
    }

    const currentStatus = normalizePaymentOrderStatus(orderRow.status);
    const incomingStatus = resolveStatusFromPayload(trustedPaymentPayload, core.status);
    const shouldTransition = shouldTransitionStatus(currentStatus, incomingStatus);

    const updatePatch: Record<string, unknown> = {
      raw_last_payload: trustedPaymentPayload ?? parsedPayload,
      provider_payment_key: paymentKey ?? orderRow.provider_payment_key,
    };

    if (shouldTransition) {
      updatePatch.status = incomingStatus;
      Object.assign(updatePatch, buildStatusPatch(incomingStatus));
    }

    const { error: orderUpdateError } = await supabase
      .from('payment_orders')
      .update(updatePatch)
      .eq('id', orderRow.id);

    if (orderUpdateError) {
      return NextResponse.json({ ok: false, error: orderUpdateError.message }, { status: 500 });
    }

    if (incomingStatus === 'CONFIRMED' || incomingStatus === 'REFUNDED' || incomingStatus === 'CANCELED') {
      const { error: entitlementError } = await supabase.rpc('recompute_supporter_entitlement', {
        p_user_id: orderRow.user_id,
      });
      if (entitlementError) {
        return NextResponse.json({ ok: false, error: entitlementError.message }, { status: 500 });
      }
    }

    await markWebhookProcessed(webhookId);

    return NextResponse.json({
      ok: true,
      orderId: orderRow.id,
      status: shouldTransition ? incomingStatus : currentStatus,
      transitioned: shouldTransition,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'payment webhook failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
