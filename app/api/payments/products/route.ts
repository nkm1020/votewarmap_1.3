import { NextResponse } from 'next/server';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import {
  isPaymentsEnabled,
  resolveCheckoutPreference,
  toProductDto,
  type PaymentCurrency,
  type SupportProductRow,
} from '@/lib/server/payments';

export const runtime = 'nodejs';

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

    const [{ data: userRow, error: userError }, { data: productRows, error: productsError }] = await Promise.all([
      supabase
        .from('users')
        .select('country_code, signup_completed_at')
        .eq('id', user.id)
        .maybeSingle(),
      supabase
        .from('support_products')
        .select('id, title, currency, amount_minor, payment_method, is_active, sort_order')
        .eq('is_active', true)
        .order('currency', { ascending: true })
        .order('sort_order', { ascending: true })
        .order('amount_minor', { ascending: true }),
    ]);

    if (userError) {
      return NextResponse.json({ error: userError.message }, { status: 500 });
    }

    if (!userRow?.signup_completed_at) {
      return NextResponse.json({ error: '가입 완료 후 후원 결제를 진행할 수 있습니다.' }, { status: 403 });
    }

    if (productsError) {
      return NextResponse.json({ error: productsError.message }, { status: 500 });
    }

    const preference = resolveCheckoutPreference(userRow?.country_code ?? null);

    const products = ((productRows ?? []) as SupportProductRow[]).map(toProductDto);

    const grouped = products.reduce<Record<PaymentCurrency, typeof products>>(
      (accumulator, product) => {
        accumulator[product.currency].push(product);
        return accumulator;
      },
      { KRW: [], USD: [] },
    );

    return NextResponse.json({
      enabled: true,
      recommended: preference,
      products,
      grouped,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'payment products fetch failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
