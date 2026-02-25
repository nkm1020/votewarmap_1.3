import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const bodySchema = z
  .object({
    nickname: z.string().trim().min(1).max(20).optional(),
    region: z
      .object({
        sidoCode: z.string().trim().min(2),
        sigunguCode: z.string().trim().min(5).nullable().optional(),
        schoolPolicy: z.enum(['keep', 'clear']),
      })
      .optional(),
  })
  .strict()
  .refine(
    (value) => typeof value.nickname !== 'undefined' || typeof value.region !== 'undefined',
    { message: '수정할 항목이 없습니다.' },
  );

export async function PATCH(request: Request) {
  try {
    const user = await resolveUserFromAuthorizationHeader(request.headers.get('authorization'));
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const rawBody = (await request.json()) as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(rawBody, 'username')) {
      return NextResponse.json({ error: '사용자명은 변경할 수 없습니다.' }, { status: 400 });
    }
    if (Object.prototype.hasOwnProperty.call(rawBody, 'avatarPreset')) {
      return NextResponse.json({ error: '아바타는 자동 랜덤 배정됩니다.' }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '잘못된 요청 형식입니다.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const payload = parsed.data;
    const updates: Record<string, unknown> = {};

    if (typeof payload.nickname !== 'undefined') {
      updates.nickname = payload.nickname;
    }

    if (typeof payload.region !== 'undefined') {
      updates.sido_code = payload.region.sidoCode;
      updates.sigungu_code = payload.region.sigunguCode ?? null;
      if (payload.region.schoolPolicy === 'clear') {
        updates.school_id = null;
      }
    }

    const supabase = getSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', user.id)
      .select(
        'id, email, full_name, nickname, username, avatar_url, avatar_preset, birth_year, gender, school_id, sido_code, sigungu_code, signup_completed_at, privacy_show_leaderboard_name, privacy_show_region, privacy_show_activity_history',
      )
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: '이미 사용 중인 사용자명입니다.' }, { status: 409 });
      }
      if (error.code === '23514') {
        return NextResponse.json({ error: '사용자명 형식이 올바르지 않습니다.' }, { status: 400 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ profile: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'my profile update failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
