import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const heartbeatSchema = z.object({
  sessionId: z.string().uuid().optional(),
});

const ACTIVE_TTL_SECONDS = 90;
const STALE_SESSION_CLEANUP_HOURS = 24;

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

    const supabase = getSupabaseServiceRoleClient();
    const sessionId = parsed.data.sessionId ?? crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const { error: upsertError } = await supabase
      .from('guest_vote_sessions')
      .upsert({ id: sessionId, last_seen_at: nowIso }, { onConflict: 'id' });

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    // Opportunistic cleanup to cap table growth from abandoned sessions.
    const staleCutoffIso = new Date(
      Date.now() - STALE_SESSION_CLEANUP_HOURS * 60 * 60 * 1000,
    ).toISOString();

    await supabase
      .from('guest_vote_sessions')
      .delete()
      .lt('last_seen_at', staleCutoffIso);

    return NextResponse.json({
      sessionId,
      expiresInSec: ACTIVE_TTL_SECONDS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'guest session heartbeat failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
