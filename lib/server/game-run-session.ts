import type { SupabaseClient } from '@supabase/supabase-js';
import { isGameFormatId } from '@/lib/game/formats';

export const GAME_RUN_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

type GameRunSessionRow = {
  run_id: string;
  user_id: string;
  mode_id: string;
  started_at: string;
  expires_at: string;
};

type ValidationFailure = {
  ok: false;
  status: 400 | 403;
  message: string;
};

type ValidationSuccess = {
  ok: true;
  elapsedMs: number;
};

function parseTimestampMs(raw: string | null | undefined): number | null {
  if (!raw) {
    return null;
  }

  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

export function isGameRunModeId(modeId: string): boolean {
  return modeId === 'region_battle' || isGameFormatId(modeId);
}

export async function registerGameRunSession(params: {
  supabase: SupabaseClient;
  userId: string;
  runId: string;
  modeId: string;
  nowMs?: number;
}): Promise<ValidationFailure | { ok: true; expiresAt: string }> {
  const nowMs = params.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const expiresAtIso = new Date(nowMs + GAME_RUN_SESSION_TTL_MS).toISOString();

  const { data: existingRow, error: existingError } = await params.supabase
    .from('game_run_sessions')
    .select('run_id, user_id, mode_id, started_at, expires_at')
    .eq('run_id', params.runId)
    .maybeSingle();

  if (existingError) {
    return {
      ok: false,
      status: 400,
      message: '게임 실행 정보를 준비하지 못했습니다.',
    };
  }

  const existing = (existingRow as GameRunSessionRow | null) ?? null;
  if (existing) {
    if (existing.user_id !== params.userId || existing.mode_id !== params.modeId) {
      return {
        ok: false,
        status: 403,
        message: '다른 사용자의 게임 실행 정보입니다.',
      };
    }

    const { error: refreshError } = await params.supabase
      .from('game_run_sessions')
      .update({ expires_at: expiresAtIso })
      .eq('run_id', params.runId);

    if (refreshError) {
      return {
        ok: false,
        status: 400,
        message: '게임 실행 정보를 갱신하지 못했습니다.',
      };
    }

    return { ok: true, expiresAt: expiresAtIso };
  }

  const { error: insertError } = await params.supabase.from('game_run_sessions').insert({
    run_id: params.runId,
    user_id: params.userId,
    mode_id: params.modeId,
    started_at: nowIso,
    expires_at: expiresAtIso,
  });

  if (insertError) {
    return {
      ok: false,
      status: 400,
      message: '게임 실행 정보를 생성하지 못했습니다.',
    };
  }

  return { ok: true, expiresAt: expiresAtIso };
}

export async function validateGameRunSession(params: {
  supabase: SupabaseClient;
  userId: string;
  runId: string;
  modeId: string;
  nowMs?: number;
}): Promise<ValidationFailure | ValidationSuccess> {
  const nowMs = params.nowMs ?? Date.now();

  const { data, error } = await params.supabase
    .from('game_run_sessions')
    .select('run_id, user_id, mode_id, started_at, expires_at')
    .eq('run_id', params.runId)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 400, message: '게임 실행 정보를 확인하지 못했습니다.' };
  }

  const row = (data as GameRunSessionRow | null) ?? null;
  if (!row) {
    return { ok: false, status: 400, message: '유효한 게임 실행 정보가 없습니다. 게임을 다시 시작해 주세요.' };
  }

  if (row.user_id !== params.userId || row.mode_id !== params.modeId) {
    return { ok: false, status: 403, message: '다른 사용자의 게임 실행 정보입니다.' };
  }

  const startedAtMs = parseTimestampMs(row.started_at);
  const expiresAtMs = parseTimestampMs(row.expires_at);
  if (startedAtMs === null || expiresAtMs === null) {
    return { ok: false, status: 400, message: '게임 실행 정보가 손상되었습니다.' };
  }

  if (nowMs > expiresAtMs) {
    return { ok: false, status: 400, message: '게임 실행 정보가 만료되었습니다. 다시 시작해 주세요.' };
  }

  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  return { ok: true, elapsedMs };
}
