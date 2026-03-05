import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { internalServerError } from '@/lib/server/api-response';
import { isGameRunModeId, registerGameRunSession } from '@/lib/server/game-run-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const bodySchema = z.object({
  runId: z.string().uuid(),
  modeId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse((await request.json()) as unknown);
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

    if (!isGameRunModeId(parsed.data.modeId)) {
      return NextResponse.json({ error: '지원하지 않는 게임 모드입니다.' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRoleClient();
    const registration = await registerGameRunSession({
      supabase,
      userId: user.id,
      runId: parsed.data.runId,
      modeId: parsed.data.modeId,
    });

    if (!registration.ok) {
      if (registration.status === 403) {
        return NextResponse.json({ error: registration.message }, { status: 403 });
      }
      return internalServerError('app/api/game/run-session/route.ts', registration.message);
    }

    return NextResponse.json({
      accepted: true,
      runId: parsed.data.runId,
      modeId: parsed.data.modeId,
      expiresAt: registration.expiresAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'game run session registration failed';
    return internalServerError('app/api/game/run-session/route.ts', message);
  }
}
