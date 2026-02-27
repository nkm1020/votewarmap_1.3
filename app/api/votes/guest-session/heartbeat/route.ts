import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const heartbeatSchema = z.object({
  sessionId: z.string().uuid().optional(),
});

const ACTIVE_TTL_SECONDS = 90;
const STALE_SESSION_CLEANUP_HOURS = 24;
const STALE_SESSION_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();
let lastCleanupAt = 0;

function resolveClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }

  return 'unknown';
}

function isRateLimited(key: string): boolean {
  const now = Date.now();

  if (rateLimitBuckets.size > 1_000) {
    for (const [bucketKey, bucketValue] of rateLimitBuckets.entries()) {
      if (now >= bucketValue.resetAt) {
        rateLimitBuckets.delete(bucketKey);
      }
    }
  }

  const bucket = rateLimitBuckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return false;
  }

  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  bucket.count += 1;
  return false;
}

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

    const rateLimitKey = `${resolveClientIp(request)}:${parsed.data.sessionId ?? 'new'}`;
    if (isRateLimited(rateLimitKey)) {
      return NextResponse.json(
        { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 429 },
      );
    }

    const supabase = getSupabaseServiceRoleClient();
    const sessionId = parsed.data.sessionId ?? crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const { error: upsertError } = await supabase
      .from('guest_vote_sessions')
      .upsert({ id: sessionId, last_seen_at: nowIso }, { onConflict: 'id' });

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    if (shouldRunCleanup()) {
      // Opportunistic cleanup to cap table growth from abandoned sessions.
      const staleCutoffIso = new Date(
        Date.now() - STALE_SESSION_CLEANUP_HOURS * 60 * 60 * 1000,
      ).toISOString();

      await supabase
        .from('guest_vote_sessions')
        .delete()
        .lt('last_seen_at', staleCutoffIso);
    }

    return NextResponse.json({
      sessionId,
      expiresInSec: ACTIVE_TTL_SECONDS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'guest session heartbeat failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
