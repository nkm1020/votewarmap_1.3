import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const mergeSchema = z.object({
  guestSessionId: z.string().uuid(),
  profile: z
    .object({
      birthYear: z.number().int().min(1900).max(2100),
      gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']),
    })
    .optional(),
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
    const { data, error } = await supabase.rpc('promote_guest_session_votes_to_user', {
      p_session_id: parsed.data.guestSessionId,
      p_user_id: user.id,
      p_birth_year: parsed.data.profile?.birthYear ?? null,
      p_gender: parsed.data.profile?.gender ?? null,
    });

    if (error) {
      const lowered = error.message.toLowerCase();
      if (lowered.includes('profile')) {
        return NextResponse.json(
          { error: '승격을 위해 출생연도/성별 정보가 필요합니다.' },
          { status: 400 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ result: data ?? { moved: 0, skipped: 0 } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'merge failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
