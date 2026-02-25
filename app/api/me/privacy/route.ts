import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const bodySchema = z
  .object({
    showLeaderboardName: z.boolean().optional(),
    showRegion: z.boolean().optional(),
    showActivityHistory: z.boolean().optional(),
  })
  .refine(
    (value) =>
      typeof value.showLeaderboardName !== 'undefined' ||
      typeof value.showRegion !== 'undefined' ||
      typeof value.showActivityHistory !== 'undefined',
    {
      message: '수정할 프라이버시 항목이 없습니다.',
    },
  );

export async function PATCH(request: Request) {
  try {
    const user = await resolveUserFromAuthorizationHeader(request.headers.get('authorization'));
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const parsed = bodySchema.safeParse((await request.json()) as unknown);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '잘못된 요청 형식입니다.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const updates: Record<string, boolean> = {};
    if (typeof parsed.data.showLeaderboardName !== 'undefined') {
      updates.privacy_show_leaderboard_name = parsed.data.showLeaderboardName;
    }
    if (typeof parsed.data.showRegion !== 'undefined') {
      updates.privacy_show_region = parsed.data.showRegion;
    }
    if (typeof parsed.data.showActivityHistory !== 'undefined') {
      updates.privacy_show_activity_history = parsed.data.showActivityHistory;
    }

    const supabase = getSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', user.id)
      .select(
        'privacy_show_leaderboard_name, privacy_show_region, privacy_show_activity_history',
      )
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      privacy: {
        showLeaderboardName: data.privacy_show_leaderboard_name,
        showRegion: data.privacy_show_region,
        showActivityHistory: data.privacy_show_activity_history,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'my privacy update failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
