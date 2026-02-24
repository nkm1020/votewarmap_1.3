import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { AVATAR_PRESETS } from '@/lib/vote/constants';

export const runtime = 'nodejs';

const completeSignupSchema = z.object({
  nickname: z.string().trim().min(1).max(20),
  avatarPreset: z.enum(AVATAR_PRESETS),
  birthYear: z.number().int().min(1900).max(2100),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']),
});

export async function POST(request: Request) {
  try {
    const rawBody = (await request.json()) as unknown;
    const parsed = completeSignupSchema.safeParse(rawBody);
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
    const { data, error } = await supabase
      .from('users')
      .update({
        nickname: parsed.data.nickname,
        avatar_preset: parsed.data.avatarPreset,
        birth_year: parsed.data.birthYear,
        gender: parsed.data.gender,
        signup_completed_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .select(
        'id, email, full_name, nickname, avatar_url, avatar_preset, provider, birth_year, gender, school_id, sido_code, sigungu_code, signup_completed_at',
      )
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ profile: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'complete signup failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
