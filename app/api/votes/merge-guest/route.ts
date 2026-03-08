import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { normalizeCountryCode } from '@/lib/server/country-policy';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { internalServerError } from '@/lib/server/api-response';

export const runtime = 'nodejs';

const mergeSchema = z.object({
  guestSessionId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const rawBody = (await request.json()) as unknown;
    const parsed = mergeSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '잘못된 요청 형식입니다.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const user = await resolveUserFromAuthorizationHeader(request.headers.get('authorization'));
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const supabase = getSupabaseServiceRoleClient();
    const { data: userRow, error: userRowError } = await supabase
      .from('users')
      .select('country_code')
      .eq('id', user.id)
      .maybeSingle();

    if (userRowError) {
      console.error('[votes/merge-guest] failed to load user country:', userRowError.message);
      return internalServerError('app/api/votes/merge-guest/route.ts', userRowError);
    }

    const userCountryCode = normalizeCountryCode((userRow as { country_code?: string | null } | null)?.country_code);
    const { data: guestVotes, error: guestVotesError } = await supabase
      .from('guest_votes_temp')
      .select('country_code')
      .eq('session_id', parsed.data.guestSessionId);

    if (guestVotesError) {
      console.error('[votes/merge-guest] failed to load guest votes:', guestVotesError.message);
      return internalServerError('app/api/votes/merge-guest/route.ts', guestVotesError);
    }

    const hasCountryMismatch = (guestVotes ?? []).some((row) => {
      const voteCountryCode = normalizeCountryCode((row as { country_code?: string | null }).country_code);
      return voteCountryCode !== userCountryCode;
    });

    if (hasCountryMismatch) {
      return NextResponse.json(
        { error: '다른 국가의 임시 투표는 병합할 수 없습니다.' },
        { status: 403 },
      );
    }

    const { data, error } = await supabase.rpc('promote_guest_session_votes_to_user', {
      p_session_id: parsed.data.guestSessionId,
      p_user_id: user.id,
      p_birth_year: null,
      p_gender: null,
    });

    if (error) {
      console.error('[votes/merge-guest] promote_guest_session_votes_to_user failed:', error.message);
      return internalServerError('app/api/votes/merge-guest/route.ts', error);
    }

    return NextResponse.json({ result: data ?? { moved: 0, skipped: 0 } });
  } catch (error) {
    return internalServerError('app/api/votes/merge-guest/route.ts', error);
  }
}
