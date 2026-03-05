import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getGameFormatById, isGameFormatId } from '@/lib/game/formats';
import type { GameScoreSubmitRequest, GameScoreSubmitResponse } from '@/lib/game/types';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { validateGameRunSession } from '@/lib/server/game-run-session';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { internalServerError } from '@/lib/server/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
const SCORE_SUBMIT_LIMIT_PER_MINUTE = 20;
const RUN_SESSION_MIN_ELAPSED_MS = 5_000;
const RAW_SCORE_BASE_ALLOWANCE = 50;
const RAW_SCORE_PER_SECOND_LIMIT = 5;

const bodySchema = z.object({
  runId: z.string().uuid(),
  modeId: z.string().min(1),
  rawScore: z.number().int().min(0).max(9999),
  normalizedScore: z.number().int().min(0).max(100),
  meta: z.record(z.string(), z.unknown()).optional(),
});

type BestRow = {
  raw_score?: number | string | null;
  mode_id?: string | null;
  normalized_score?: number | string | null;
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
    const parsed = bodySchema.safeParse((await request.json()) as unknown);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '잘못된 요청 형식입니다.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const payload = parsed.data as GameScoreSubmitRequest;
    if (!isGameFormatId(payload.modeId)) {
      return NextResponse.json({ error: '지원하지 않는 게임 모드입니다.' }, { status: 400 });
    }

    const normalizedByServer = getGameFormatById(payload.modeId).normalize(payload.rawScore);
    if (payload.normalizedScore !== normalizedByServer) {
      return NextResponse.json({ error: '점수 검증에 실패했습니다.' }, { status: 400 });
    }

    const user = await resolveUserFromAuthorizationHeader(request.headers.get('authorization'));
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const supabase = getSupabaseServiceRoleClient();
    const runValidation = await validateGameRunSession({
      supabase,
      userId: user.id,
      runId: payload.runId,
      modeId: payload.modeId,
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

    const maxAllowedRawScore = Math.min(
      9999,
      RAW_SCORE_BASE_ALLOWANCE + Math.trunc((runValidation.elapsedMs / 1000) * RAW_SCORE_PER_SECOND_LIMIT),
    );
    if (payload.rawScore > maxAllowedRawScore) {
      return NextResponse.json(
        { error: '비정상 점수로 감지되어 저장할 수 없습니다. 게임을 다시 시작해 주세요.' },
        { status: 400 },
      );
    }

    const rateLimitWindowIso = new Date(Date.now() - 60 * 1000).toISOString();
    const { count: recentSubmitCount, error: rateLimitError } = await supabase
      .from('game_mode_scores')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('played_at', rateLimitWindowIso);

    if (rateLimitError) {
      return internalServerError('app/api/game/score/route.ts', rateLimitError.message);
    }

    if ((recentSubmitCount ?? 0) >= SCORE_SUBMIT_LIMIT_PER_MINUTE) {
      return NextResponse.json(
        { error: '점수 저장 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 429 },
      );
    }

    const { error: insertError } = await supabase.from('game_mode_scores').insert({
      user_id: user.id,
      mode_id: payload.modeId,
      run_id: payload.runId,
      raw_score: payload.rawScore,
      normalized_score: payload.normalizedScore,
      meta: payload.meta ?? {},
    });

    let duplicated = false;
    if (insertError) {
      const duplicateCode = insertError.code === '23505';
      const duplicateMessage = insertError.message.toLowerCase().includes('duplicate');
      if (duplicateCode || duplicateMessage) {
        duplicated = true;
      } else {
        return internalServerError('app/api/game/score/route.ts', insertError.message);
      }
    }

    const { data: modeBestRows, error: modeBestError } = await supabase
      .from('game_mode_scores')
      .select('raw_score')
      .eq('user_id', user.id)
      .eq('mode_id', payload.modeId)
      .order('raw_score', { ascending: false })
      .order('played_at', { ascending: true })
      .limit(1);

    if (modeBestError) {
      return internalServerError('app/api/game/score/route.ts', modeBestError.message);
    }

    const { data: globalBestRows, error: globalBestError } = await supabase
      .from('game_mode_scores')
      .select('mode_id, normalized_score')
      .eq('user_id', user.id);

    if (globalBestError) {
      return internalServerError('app/api/game/score/route.ts', globalBestError.message);
    }

    const perModeBest = new Map<string, number>();
    ((globalBestRows ?? []) as BestRow[]).forEach((row) => {
      const modeId = String(row.mode_id ?? '').trim();
      if (!modeId) {
        return;
      }
      const normalizedScore = normalizeInt(row.normalized_score);
      const previous = perModeBest.get(modeId) ?? 0;
      if (normalizedScore > previous) {
        perModeBest.set(modeId, normalizedScore);
      }
    });
    const bestGlobalNormalizedScore = Array.from(perModeBest.values()).reduce(
      (sum, value) => sum + value,
      0,
    );

    const responseBody: GameScoreSubmitResponse = {
      saved: true,
      ...(duplicated ? { duplicated: true } : {}),
      bestModeRawScore: normalizeInt(((modeBestRows ?? []) as BestRow[])[0]?.raw_score),
      bestGlobalNormalizedScore,
    };

    return NextResponse.json(responseBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'game score save failed';
    return internalServerError('app/api/game/score/route.ts', message);
  }
}
