import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildGuestFingerprintHash } from '@/lib/server/guest-fingerprint';
import { checkRateLimit } from '@/lib/server/request-rate-limit';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { internalServerError } from '@/lib/server/api-response';

export const runtime = 'nodejs';

const heartbeatSchema = z.object({
  sessionId: z.string().uuid().optional(),
});

const ACTIVE_TTL_SECONDS = 90;
const STALE_SESSION_CLEANUP_HOURS = 24;
const STALE_SESSION_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;

let lastCleanupAt = 0;

type GuestSessionRow = {
  id: string;
  fingerprint_hash: string | null;
  last_seen_at?: string | null;
};

function shouldRunCleanup(): boolean {
  const now = Date.now();
  if (now - lastCleanupAt < STALE_SESSION_CLEANUP_INTERVAL_MS) {
    return false;
  }

  lastCleanupAt = now;
  return true;
}

export async function POST(request: Request) {
  try {
    const rawBody = (await request.json().catch(() => ({}))) as unknown;
    const parsed = heartbeatSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '잘못된 요청 형식입니다.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const fingerprintHash = buildGuestFingerprintHash(request);
    const rateLimit = await checkRateLimit({
      scope: 'guest-session-heartbeat',
      key: fingerprintHash,
      maxRequests: RATE_LIMIT_MAX_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    if (rateLimit.limited) {
      return NextResponse.json(
        { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimit.retryAfterSec),
          },
        },
      );
    }

    const supabase = getSupabaseServiceRoleClient();
    const nowIso = new Date().toISOString();
    const staleCutoffIso = new Date(Date.now() - STALE_SESSION_CLEANUP_HOURS * 60 * 60 * 1000).toISOString();

    let sessionId: string | null = null;
    const requestedSessionId = parsed.data.sessionId ?? null;

    if (requestedSessionId) {
      const { data: requestedSession, error: requestedSessionError } = await supabase
        .from('guest_vote_sessions')
        .select('id, fingerprint_hash, last_seen_at')
        .eq('id', requestedSessionId)
        .maybeSingle();

      if (requestedSessionError) {
        return internalServerError(
          'app/api/votes/guest-session/heartbeat/route.ts',
          requestedSessionError.message,
        );
      }

      const row = (requestedSession as GuestSessionRow | null) ?? null;
      if (row && (!row.fingerprint_hash || row.fingerprint_hash === fingerprintHash)) {
        sessionId = row.id;
      }
    }

    if (!sessionId) {
      const { data: existingSession, error: existingSessionError } = await supabase
        .from('guest_vote_sessions')
        .select('id, fingerprint_hash, last_seen_at')
        .eq('fingerprint_hash', fingerprintHash)
        .gte('last_seen_at', staleCutoffIso)
        .order('last_seen_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingSessionError) {
        return internalServerError(
          'app/api/votes/guest-session/heartbeat/route.ts',
          existingSessionError.message,
        );
      }

      sessionId = ((existingSession as GuestSessionRow | null) ?? null)?.id ?? crypto.randomUUID();
    }

    const { error: upsertError } = await supabase.from('guest_vote_sessions').upsert(
      {
        id: sessionId,
        last_seen_at: nowIso,
        fingerprint_hash: fingerprintHash,
      },
      { onConflict: 'id' },
    );

    if (upsertError) {
      return internalServerError('app/api/votes/guest-session/heartbeat/route.ts', upsertError.message);
    }

    if (shouldRunCleanup()) {
      await supabase.from('guest_vote_sessions').delete().lt('last_seen_at', staleCutoffIso);
    }

    return NextResponse.json({
      sessionId,
      expiresInSec: ACTIVE_TTL_SECONDS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'guest session heartbeat failed';
    return internalServerError('app/api/votes/guest-session/heartbeat/route.ts', message);
  }
}
