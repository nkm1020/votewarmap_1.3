import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { internalServerError } from '@/lib/server/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const querySchema = z.object({
  period: z.enum(['daily', 'weekly', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const FALLBACK_FETCH_LIMIT = 5000;

type LeaderboardPeriod = 'daily' | 'weekly' | 'all';

type LeaderboardRpcRow = {
  rank: number | string | null;
  user_id: string | null;
  score: number | string | null;
  achieved_at: string | null;
};

type LeaderboardRawScoreRow = {
  user_id: string | null;
  score: number | string | null;
  played_at: string | null;
};

type UserRow = {
  id: string;
  nickname: string | null;
  full_name: string | null;
  email: string | null;
  privacy_show_leaderboard_name: boolean | null;
};

type LeaderboardItem = {
  rank: number;
  displayName: string;
  score: number;
  achievedAt: string;
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

function kstDayStartMs(baseUtcMs: number): number {
  const kst = new Date(baseUtcMs + KST_OFFSET_MS);
  return Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
}

function kstWeekStartMs(baseUtcMs: number): number {
  const kst = new Date(baseUtcMs + KST_OFFSET_MS);
  const weekday = kst.getUTCDay();
  const diffToMonday = (weekday + 6) % 7;
  return Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - diffToMonday);
}

function shouldIncludeByPeriod(playedAtIso: string, period: LeaderboardPeriod): boolean {
  if (period === 'all') {
    return true;
  }

  const playedAtMs = Date.parse(playedAtIso);
  if (!Number.isFinite(playedAtMs)) {
    return false;
  }

  const playedAtKstMs = playedAtMs + KST_OFFSET_MS;
  const nowUtcMs = Date.now();
  if (period === 'daily') {
    return playedAtKstMs >= kstDayStartMs(nowUtcMs);
  }
  return playedAtKstMs >= kstWeekStartMs(nowUtcMs);
}

function isMissingFunctionError(code: string | undefined, message: string): boolean {
  const normalized = message.toLowerCase();
  if (code === '42883') {
    return true;
  }
  return normalized.includes('get_region_battle_leaderboard') && normalized.includes('does not exist');
}

function isMissingTableError(code: string | undefined, message: string): boolean {
  const normalized = message.toLowerCase();
  if (code === '42p01') {
    return true;
  }
  return normalized.includes('region_battle_game_scores') && normalized.includes('does not exist');
}

async function loadRowsFallback(
  supabase: ReturnType<typeof getSupabaseServiceRoleClient>,
  period: LeaderboardPeriod,
  limit: number,
): Promise<{ rows: LeaderboardRpcRow[]; error: { message: string; code?: string } | null }> {
  const { data, error } = await supabase
    .from('region_battle_game_scores')
    .select('user_id, score, played_at')
    .order('played_at', { ascending: false })
    .limit(FALLBACK_FETCH_LIMIT);

  if (error) {
    return { rows: [], error: { message: error.message, code: error.code } };
  }

  const sourceRows = (Array.isArray(data) ? data : []) as LeaderboardRawScoreRow[];
  const bestByUser = new Map<string, { score: number; achievedAt: string; achievedAtMs: number }>();

  for (const row of sourceRows) {
    const userId = String(row.user_id ?? '').trim();
    if (!userId) {
      continue;
    }

    const achievedAt = normalizeTimestamp(row.played_at);
    if (!shouldIncludeByPeriod(achievedAt, period)) {
      continue;
    }

    const achievedAtMs = Date.parse(achievedAt);
    if (!Number.isFinite(achievedAtMs)) {
      continue;
    }

    const score = normalizeInt(row.score);
    const current = bestByUser.get(userId);
    if (!current) {
      bestByUser.set(userId, { score, achievedAt, achievedAtMs });
      continue;
    }

    if (score > current.score || (score === current.score && achievedAtMs < current.achievedAtMs)) {
      bestByUser.set(userId, { score, achievedAt, achievedAtMs });
    }
  }

  const rankedRows = Array.from(bestByUser.entries())
    .map(([userId, value]) => ({
      user_id: userId,
      score: value.score,
      achieved_at: value.achievedAt,
    }))
    .sort((a, b) => {
      const scoreDiff = normalizeInt(b.score) - normalizeInt(a.score);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      const achievedDiff = Date.parse(a.achieved_at ?? '') - Date.parse(b.achieved_at ?? '');
      if (achievedDiff !== 0) {
        return achievedDiff;
      }
      return String(a.user_id ?? '').localeCompare(String(b.user_id ?? ''));
    })
    .slice(0, limit)
    .map((row, index) => ({
      rank: index + 1,
      user_id: row.user_id,
      score: row.score,
      achieved_at: row.achieved_at,
    }));

  return { rows: rankedRows, error: null };
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

    const { period, limit } = parsed.data;
    const supabase = getSupabaseServiceRoleClient();

    const { data: leaderboardRows, error: leaderboardError } = await supabase.rpc(
      'get_region_battle_leaderboard',
      {
        p_period: period,
        p_limit: limit,
      },
    );

    let rows: LeaderboardRpcRow[] = [];
    if (leaderboardError) {
      if (!isMissingFunctionError(leaderboardError.code, leaderboardError.message)) {
        return internalServerError('app/api/game/region-battle-leaderboard/route.ts', leaderboardError.message);
      }

      const fallbackResult = await loadRowsFallback(supabase, period, limit);
      if (fallbackResult.error) {
        if (isMissingTableError(fallbackResult.error.code, fallbackResult.error.message)) {
          rows = [];
        } else {
          return internalServerError('app/api/game/region-battle-leaderboard/route.ts', fallbackResult.error.message);
        }
      } else {
        rows = fallbackResult.rows;
      }
    } else {
      rows = (Array.isArray(leaderboardRows) ? leaderboardRows : []) as LeaderboardRpcRow[];
    }

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
        return internalServerError('app/api/game/region-battle-leaderboard/route.ts', usersError.message);
      }
      usersById = new Map(((userRows ?? []) as UserRow[]).map((row) => [row.id, row]));
    }

    const items: LeaderboardItem[] = rows.map((row) => {
      const userId = String(row.user_id ?? '').trim();
      const score = normalizeInt(row.score);
      const rank = normalizeInt(row.rank);
      const achievedAt = normalizeTimestamp(row.achieved_at);

      return {
        rank,
        displayName: toDisplayName(usersById.get(userId)),
        score,
        achievedAt,
      };
    });

    return NextResponse.json({
      items,
      meta: {
        period,
        limit,
        itemCount: items.length,
        timezone: 'Asia/Seoul',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'region battle leaderboard fetch failed';
    return internalServerError('app/api/game/region-battle-leaderboard/route.ts', message);
  }
}
