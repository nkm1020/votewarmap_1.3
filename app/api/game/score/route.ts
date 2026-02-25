import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isGameFormatId } from '@/lib/game/formats';
import type { GameScoreSubmitRequest, GameScoreSubmitResponse } from '@/lib/game/types';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

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

    const user = await resolveUserFromAuthorizationHeader(request.headers.get('authorization'));
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const supabase = getSupabaseServiceRoleClient();

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
        return NextResponse.json({ error: insertError.message }, { status: 500 });
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
      return NextResponse.json({ error: modeBestError.message }, { status: 500 });
    }

    const { data: globalBestRows, error: globalBestError } = await supabase
      .from('game_mode_scores')
      .select('mode_id, normalized_score')
      .eq('user_id', user.id);

    if (globalBestError) {
      return NextResponse.json({ error: globalBestError.message }, { status: 500 });
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
