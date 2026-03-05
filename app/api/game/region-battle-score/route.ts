import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { validateGameRunSession } from '@/lib/server/game-run-session';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { internalServerError } from '@/lib/server/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
const SCORE_SUBMIT_LIMIT_PER_MINUTE = 20;
const RUN_SESSION_MIN_ELAPSED_MS = 8_000;
const SCORE_BASE_ALLOWANCE = 30;
const SCORE_PER_SECOND_LIMIT = 2.5;

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
    const runValidation = await validateGameRunSession({
      supabase,
      userId: user.id,
      runId,
      modeId: 'region_battle',
    });
    if (!runValidation.ok) {
      return NextResponse.json({ error: runValidation.message }, { status: runValidation.status });
    }

    if (runValidation.elapsedMs < RUN_SESSION_MIN_ELAPSED_MS) {
      return NextResponse.json(
        { error: '플레이 시간이 너무 짧아 점수를 저장할 수 없습니다. 다시 시도해 주세요.' },
        { status: 400 },
      );
    }

    const maxAllowedScore = Math.min(
      9999,
      SCORE_BASE_ALLOWANCE + Math.trunc((runValidation.elapsedMs / 1000) * SCORE_PER_SECOND_LIMIT),
    );
    if (score > maxAllowedScore) {
      return NextResponse.json(
        { error: '비정상 점수로 감지되어 저장할 수 없습니다. 게임을 다시 시작해 주세요.' },
        { status: 400 },
      );
    }

    const rateLimitWindowIso = new Date(Date.now() - 60 * 1000).toISOString();
    const { count: recentSubmitCount, error: rateLimitError } = await supabase
      .from('region_battle_game_scores')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('played_at', rateLimitWindowIso);

    if (rateLimitError) {
      return internalServerError('app/api/game/region-battle-score/route.ts', rateLimitError.message);
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
        return internalServerError('app/api/game/region-battle-score/route.ts', insertError.message);
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
      return internalServerError('app/api/game/region-battle-score/route.ts', bestError.message);
    }

    const bestScoreAllTime = normalizeInt(((bestRows ?? []) as BestScoreRow[])[0]?.score);
    return NextResponse.json({
      saved: true,
      ...(duplicated ? { duplicated: true } : {}),
      bestScoreAllTime,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'region battle score save failed';
    return internalServerError('app/api/game/region-battle-score/route.ts', message);
  }
}
