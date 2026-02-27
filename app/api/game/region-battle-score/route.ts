import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
const SCORE_SUBMIT_LIMIT_PER_MINUTE = 20;

const bodySchema = z.object({
  runId: z.string().uuid(),
  score: z.number().int().min(0).max(9999),
});

type BestScoreRow = {
  score: number | string | null;
};

function normalizeInt(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }
  return 0;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    const parsed = bodySchema.safeParse(body);
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
    const { runId, score } = parsed.data;
    const rateLimitWindowIso = new Date(Date.now() - 60 * 1000).toISOString();
    const { count: recentSubmitCount, error: rateLimitError } = await supabase
      .from('region_battle_game_scores')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('played_at', rateLimitWindowIso);

    if (rateLimitError) {
      return NextResponse.json({ error: rateLimitError.message }, { status: 500 });
    }

    if ((recentSubmitCount ?? 0) >= SCORE_SUBMIT_LIMIT_PER_MINUTE) {
      return NextResponse.json(
        { error: '점수 저장 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 429 },
      );
    }

    const { error: insertError } = await supabase.from('region_battle_game_scores').insert({
      user_id: user.id,
      run_id: runId,
      score,
    });

    let duplicated = false;
    if (insertError) {
      const duplicateCode = insertError.code === '23505';
      const duplicateMessage = insertError.message.toLowerCase().includes('duplicate');
      if (duplicateCode || duplicateMessage) {
        duplicated = true;
      } else {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    const { data: bestRows, error: bestError } = await supabase
      .from('region_battle_game_scores')
      .select('score')
      .eq('user_id', user.id)
      .order('score', { ascending: false })
      .order('played_at', { ascending: true })
      .limit(1);

    if (bestError) {
      return NextResponse.json({ error: bestError.message }, { status: 500 });
    }

    const bestScoreAllTime = normalizeInt(((bestRows ?? []) as BestScoreRow[])[0]?.score);
    return NextResponse.json({
      saved: true,
      ...(duplicated ? { duplicated: true } : {}),
      bestScoreAllTime,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'region battle score save failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
