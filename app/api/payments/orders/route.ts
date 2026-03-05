import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import {
  amountMinorToMajor,
  buildCheckoutUrls,
  generateIdempotencyKey,
  generateProviderOrderId,
  isPaymentsEnabled,
  resolveAppBaseUrl,
  type SupportProductRow,
} from '@/lib/server/payments';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const bodySchema = z.object({
  productId: z.string().uuid(),
});

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

    const [{ data: userRow, error: userError }, { data: productRow, error: productError }] = await Promise.all([
      supabase
        .from('users')
        .select('country_code, signup_completed_at, nickname, full_name')
        .eq('id', user.id)
        .maybeSingle(),
      supabase
        .from('support_products')
        .select('id, title, currency, amount_minor, payment_method, is_active, sort_order')
        .eq('id', parsed.data.productId)
        .eq('is_active', true)
        .maybeSingle(),
    ]);

    if (userError) {
      return NextResponse.json({ error: userError.message }, { status: 500 });
    }

    if (!userRow?.signup_completed_at) {
      return NextResponse.json({ error: '가입 완료 후 후원 결제를 진행할 수 있습니다.' }, { status: 403 });
    }

    if (productError) {
      return NextResponse.json({ error: productError.message }, { status: 500 });
    }

    if (!productRow) {
      return NextResponse.json({ error: '유효하지 않은 후원 상품입니다.' }, { status: 400 });
    }

    const product = productRow as SupportProductRow;
    const providerOrderId = generateProviderOrderId();
    const idempotencyKey = generateIdempotencyKey();

    const { error: insertError } = await supabase.from('payment_orders').insert({
      user_id: user.id,
      product_id: product.id,
      provider: 'toss',
      payment_method: product.payment_method,
      currency: product.currency,
      amount_minor: product.amount_minor,
      provider_order_id: providerOrderId,
      status: 'PENDING',
      idempotency_key: idempotencyKey,
    });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    const baseUrl = resolveAppBaseUrl(request);
    const { successUrl, failUrl } = buildCheckoutUrls(baseUrl);
    const amount = amountMinorToMajor(product.currency, product.amount_minor);
    const customerName =
      (typeof userRow.nickname === 'string' && userRow.nickname.trim().length > 0
        ? userRow.nickname
        : typeof userRow.full_name === 'string' && userRow.full_name.trim().length > 0
          ? userRow.full_name
          : null) ?? undefined;

    return NextResponse.json({
      orderId: providerOrderId,
      orderName: product.title,
      amount,
      currency: product.currency,
      paymentMethod: product.payment_method,
      checkoutPayload: {
        method: product.payment_method === 'PAYPAL' ? 'FOREIGN_EASY_PAY' : 'CARD',
        amount: {
          currency: product.currency,
          value: amount,
        },
        orderId: providerOrderId,
        orderName: product.title,
        successUrl,
        failUrl,
        customerEmail: user.email ?? undefined,
        customerName,
        ...(product.payment_method === 'PAYPAL' ? { easyPay: 'PAYPAL' } : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'payment order create failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
