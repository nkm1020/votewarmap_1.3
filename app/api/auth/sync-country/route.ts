import { NextResponse } from 'next/server';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { normalizeCountryCode, resolveCountryCodeFromRequest } from '@/lib/server/country-policy';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { internalServerError } from '@/lib/server/api-response';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const user = await resolveUserFromAuthorizationHeader(request.headers.get('authorization'));
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const countryCode = resolveCountryCodeFromRequest(request);
    const supabase = getSupabaseServiceRoleClient();
    const { data: row, error: fetchError } = await supabase
      .from('users')
      .select('country_code')
      .eq('id', user.id)
      .maybeSingle();

    if (fetchError) {
      return internalServerError('app/api/auth/sync-country/route.ts', fetchError.message);
    }

    const currentCountryCode = normalizeCountryCode(
      (row as { country_code?: string | null } | null)?.country_code,
    );
    if (currentCountryCode !== countryCode) {
      const { error: updateError } = await supabase
        .from('users')
        .update({ country_code: countryCode })
        .eq('id', user.id);

      if (updateError) {
        return internalServerError('app/api/auth/sync-country/route.ts', updateError.message);
      }
    }

    return NextResponse.json({ countryCode });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'country sync failed';
    return internalServerError('app/api/auth/sync-country/route.ts', message);
  }
}
