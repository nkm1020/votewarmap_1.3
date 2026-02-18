import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const mergeSchema = z.object({
  guestToken: z.string().uuid(),
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
    const { data, error } = await supabase.rpc('merge_guest_votes_to_user', {
      p_guest_token: parsed.data.guestToken,
      p_user_id: user.id,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ result: data ?? { moved: 0, skipped: 0 } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'merge failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
