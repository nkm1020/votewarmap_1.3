import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isGameFormatId } from '@/lib/game/formats';
import type { GameLeaderboardResponse } from '@/lib/game/types';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const querySchema = z.object({
  modeId: z.string().trim().min(1).default('all'),
  period: z.enum(['daily', 'weekly', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

type LeaderboardRpcRow = {
  rank: number | string | null;
  user_id: string | null;
  score: number | string | null;
  achieved_at: string | null;
};

type UserRow = {
  id: string;
  nickname: string | null;
  full_name: string | null;
  email: string | null;
  privacy_show_leaderboard_name: boolean | null;
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

function normalizeTimestamp(value: string | null): string {
  if (!value) {
    return new Date(0).toISOString();
  }
  return Number.isFinite(Date.parse(value)) ? value : new Date(0).toISOString();
}

function maskFullName(raw: string): string {
  const name = raw.trim();
  if (!name) {
    return '';
  }
  const chars = Array.from(name);
  if (chars.length <= 1) {
    return `${chars[0]}*`;
  }
  if (chars.length === 2) {
    return `${chars[0]}*`;
  }
  return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

function maskEmailLocalPart(raw: string): string {
  const email = raw.trim();
  if (!email) {
    return '';
  }
  const localPart = email.split('@')[0] ?? '';
  if (!localPart) {
    return '';
  }
  const chars = Array.from(localPart);
  if (chars.length <= 1) {
    return `${chars[0]}*`;
  }
  if (chars.length === 2) {
    return `${chars[0]}*`;
  }
  return `${chars[0]}${chars[1]}***`;
}

function toDisplayName(row: UserRow | undefined): string {
  if (!row) {
    return '익명';
  }
  if (row.privacy_show_leaderboard_name === false) {
    return '익명';
  }
  if (row.nickname && row.nickname.trim()) {
    return row.nickname.trim();
  }
  if (row.full_name && row.full_name.trim()) {
    return maskFullName(row.full_name);
  }
  if (row.email && row.email.trim()) {
    return maskEmailLocalPart(row.email);
  }
  return '익명';
}

export async function GET(request: Request) {
  try {
    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );

    if (!parsed.success) {
      return NextResponse.json(
        { error: '잘못된 조회 파라미터입니다.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { modeId, period, limit } = parsed.data;
    if (modeId !== 'all' && !isGameFormatId(modeId)) {
      return NextResponse.json({ error: '지원하지 않는 게임 모드입니다.' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRoleClient();
    const { data: leaderboardRows, error: leaderboardError } = await supabase.rpc('get_game_leaderboard', {
      p_mode_id: modeId,
      p_period: period,
      p_limit: limit,
    });

    if (leaderboardError) {
      return NextResponse.json({ error: leaderboardError.message }, { status: 500 });
    }

    const rows = (Array.isArray(leaderboardRows) ? leaderboardRows : []) as LeaderboardRpcRow[];
    const userIds = Array.from(
      new Set(
        rows
          .map((row) => String(row.user_id ?? '').trim())
          .filter((userId) => userId.length > 0),
      ),
    );

    let usersById = new Map<string, UserRow>();
    if (userIds.length > 0) {
      const { data: userRows, error: usersError } = await supabase
        .from('users')
        .select('id, nickname, full_name, email, privacy_show_leaderboard_name')
        .in('id', userIds);

      if (usersError) {
        return NextResponse.json({ error: usersError.message }, { status: 500 });
      }

      usersById = new Map(((userRows ?? []) as UserRow[]).map((row) => [row.id, row]));
    }

    const items = rows.map((row) => {
      const userId = String(row.user_id ?? '').trim();
      return {
        rank: normalizeInt(row.rank),
        displayName: toDisplayName(usersById.get(userId)),
        score: normalizeInt(row.score),
        achievedAt: normalizeTimestamp(row.achieved_at),
      };
    });

    const payload: GameLeaderboardResponse = {
      items,
      meta: {
        modeId: modeId === 'all' ? 'all' : modeId,
        period,
        limit,
        itemCount: items.length,
        timezone: 'Asia/Seoul',
      },
    };

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'game leaderboard fetch failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
