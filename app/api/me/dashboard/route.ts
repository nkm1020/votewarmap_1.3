import { NextResponse } from 'next/server';
import { computeBadges, computeLevel } from '@/lib/me/progression';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { getRegionNameByCodes } from '@/lib/server/region-names';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

type DashboardUserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  nickname: string | null;
  username: string | null;
  avatar_url: string | null;
  avatar_preset: string | null;
  created_at: string;
  sido_code: string | null;
  sigungu_code: string | null;
  privacy_show_leaderboard_name: boolean | null;
  privacy_show_region: boolean | null;
  privacy_show_activity_history: boolean | null;
};

type MetricRpcRow = {
  my_region_match_rate: number | string | null;
  nationwide_match_rate: number | string | null;
  dominance_gap_delta: number | string | null;
  region_national_flow: number | string | null;
};

type RankRpcRow = {
  rank: number | string | null;
  score: number | string | null;
  achieved_at: string | null;
};

type UserVoteRegionRow = {
  sido_code: string | null;
  sigungu_code: string | null;
  created_at: string;
};

type ModeScoreRow = {
  mode_id: string | null;
  normalized_score: number | string | null;
};

type RegionBattleRow = {
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

function normalizeFloat(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function defaultUsername(userId: string): string {
  const compact = userId.replace(/-/g, '').slice(0, 8).toLowerCase();
  return `user_${compact}`;
}

function getDisplayName(row: DashboardUserRow): string {
  const nickname = row.nickname?.trim();
  if (nickname) {
    return nickname;
  }

  const fullName = row.full_name?.trim();
  if (fullName) {
    return fullName;
  }

  const email = row.email?.trim();
  if (email) {
    return email;
  }

  return '사용자';
}

async function ensureUserRow(user: Awaited<ReturnType<typeof resolveUserFromAuthorizationHeader>>): Promise<DashboardUserRow | null> {
  if (!user) {
    return null;
  }

  const supabase = getSupabaseServiceRoleClient();
  const selectFields =
    'id, email, full_name, nickname, username, avatar_url, avatar_preset, created_at, sido_code, sigungu_code, privacy_show_leaderboard_name, privacy_show_region, privacy_show_activity_history';

  const { data: existingRow, error: existingError } = await supabase
    .from('users')
    .select(selectFields)
    .eq('id', user.id)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existingRow) {
    return existingRow as DashboardUserRow;
  }

  const generatedUsername = defaultUsername(user.id);
  const upsertPayload = {
    id: user.id,
    email: user.email ?? null,
    full_name: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.name as string | undefined) ?? null,
    provider: (user.app_metadata?.provider as string | undefined) ?? null,
    username: generatedUsername,
  };

  const { error: upsertError } = await supabase.from('users').upsert(upsertPayload, { onConflict: 'id' });
  if (upsertError) {
    throw new Error(upsertError.message);
  }

  const { data: createdRow, error: createdError } = await supabase
    .from('users')
    .select(selectFields)
    .eq('id', user.id)
    .single();

  if (createdError) {
    throw new Error(createdError.message);
  }

  return createdRow as DashboardUserRow;
}

export async function GET(request: Request) {
  try {
    const user = await resolveUserFromAuthorizationHeader(request.headers.get('authorization'));
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const supabase = getSupabaseServiceRoleClient();
    const userRow = await ensureUserRow(user);
    if (!userRow) {
      return NextResponse.json({ error: '사용자 정보를 찾을 수 없습니다.' }, { status: 404 });
    }

    const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      totalVotesResult,
      recentVotesResult,
      modeScoresResult,
      regionBattleBestResult,
      gameRankResult,
      regionBattleRankResult,
      northstarMetricResult,
      recentModeGamesResult,
      recentRegionBattleGamesResult,
      userVoteRegionsResult,
    ] = await Promise.all([
      supabase.from('votes').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      supabase
        .from('votes')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', sevenDaysAgoIso),
      supabase.from('game_mode_scores').select('mode_id, normalized_score').eq('user_id', user.id),
      supabase
        .from('region_battle_game_scores')
        .select('score')
        .eq('user_id', user.id)
        .order('score', { ascending: false })
        .order('played_at', { ascending: true })
        .limit(1),
      supabase.rpc('get_game_user_rank', {
        p_user_id: user.id,
        p_mode_id: 'all',
        p_period: 'all',
      }),
      supabase.rpc('get_region_battle_user_rank', {
        p_user_id: user.id,
        p_period: 'all',
      }),
      supabase.rpc('get_my_vote_comparison_metrics', {
        p_user_id: user.id,
      }),
      supabase
        .from('game_mode_scores')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('played_at', sevenDaysAgoIso),
      supabase
        .from('region_battle_game_scores')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('played_at', sevenDaysAgoIso),
      supabase
        .from('votes')
        .select('sido_code, sigungu_code, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
    ]);

    const queryErrors = [
      totalVotesResult.error,
      recentVotesResult.error,
      modeScoresResult.error,
      regionBattleBestResult.error,
      gameRankResult.error,
      regionBattleRankResult.error,
      northstarMetricResult.error,
      recentModeGamesResult.error,
      recentRegionBattleGamesResult.error,
      userVoteRegionsResult.error,
    ].filter((item) => Boolean(item));

    if (queryErrors.length > 0) {
      const firstError = queryErrors[0];
      return NextResponse.json({ error: firstError?.message ?? '대시보드 조회에 실패했습니다.' }, { status: 500 });
    }

    const totalVotes = totalVotesResult.count ?? 0;
    const recentVotes = recentVotesResult.count ?? 0;
    const recentModeGames = recentModeGamesResult.count ?? 0;
    const recentRegionBattleGames = recentRegionBattleGamesResult.count ?? 0;
    const recentGames = recentModeGames + recentRegionBattleGames;

    const bestModeById = new Map<string, number>();
    ((modeScoresResult.data ?? []) as ModeScoreRow[]).forEach((row) => {
      const modeId = String(row.mode_id ?? '').trim();
      if (!modeId) {
        return;
      }
      const normalized = normalizeInt(row.normalized_score);
      const previous = bestModeById.get(modeId) ?? 0;
      if (normalized > previous) {
        bestModeById.set(modeId, normalized);
      }
    });

    const modeScoreSum = Array.from(bestModeById.values()).reduce((sum, value) => sum + value, 0);
    const bestRegionBattleRawScore = normalizeInt(((regionBattleBestResult.data ?? []) as RegionBattleRow[])[0]?.score);
    const totalGameScore = modeScoreSum + Math.min(100, bestRegionBattleRawScore);

    const gameRankRows = (Array.isArray(gameRankResult.data) ? gameRankResult.data : []) as RankRpcRow[];
    const regionBattleRankRows = (Array.isArray(regionBattleRankResult.data)
      ? regionBattleRankResult.data
      : []) as RankRpcRow[];
    const gameRankOverall = normalizeInt(gameRankRows[0]?.rank);
    const gameRankRegionBattle = normalizeInt(regionBattleRankRows[0]?.rank);

    const northstarRows = (Array.isArray(northstarMetricResult.data)
      ? northstarMetricResult.data
      : []) as MetricRpcRow[];
    const northstar = northstarRows[0] ?? {
      my_region_match_rate: 0,
      nationwide_match_rate: 0,
      dominance_gap_delta: 0,
      region_national_flow: 0,
    };

    const northstarMetrics = {
      myRegionMatchRate: roundTwo(normalizeFloat(northstar.my_region_match_rate)),
      nationwideMatchRate: roundTwo(normalizeFloat(northstar.nationwide_match_rate)),
      dominanceGapDelta: roundTwo(normalizeFloat(northstar.dominance_gap_delta)),
      regionNationalFlow: roundTwo(normalizeFloat(northstar.region_national_flow)),
    };

    const voteRegionRows = (userVoteRegionsResult.data ?? []) as UserVoteRegionRow[];
    const regionActivityMap = new Map<string, { level: 'sido' | 'sigungu'; code: string; voteCount: number; latestAt: string }>();
    voteRegionRows.forEach((row) => {
      const sigunguCode = String(row.sigungu_code ?? '').trim();
      const sidoCode = String(row.sido_code ?? '').trim();
      const level: 'sido' | 'sigungu' = sigunguCode ? 'sigungu' : 'sido';
      const code = sigunguCode || sidoCode;
      if (!code) {
        return;
      }

      const key = `${level}:${code}`;
      const previous = regionActivityMap.get(key);
      if (!previous) {
        regionActivityMap.set(key, {
          level,
          code,
          voteCount: 1,
          latestAt: row.created_at,
        });
        return;
      }

      previous.voteCount += 1;
      if (Date.parse(row.created_at) > Date.parse(previous.latestAt)) {
        previous.latestAt = row.created_at;
      }
    });

    const mostActiveRegion = Array.from(regionActivityMap.values())
      .sort((a, b) => {
        if (b.voteCount !== a.voteCount) {
          return b.voteCount - a.voteCount;
        }
        const dateDiff = Date.parse(b.latestAt) - Date.parse(a.latestAt);
        if (dateDiff !== 0) {
          return dateDiff;
        }
        return a.code.localeCompare(b.code);
      })
      .at(0);

    const mostActiveRegionPayload = mostActiveRegion
      ? {
          level: mostActiveRegion.level,
          code: mostActiveRegion.code,
          name:
            mostActiveRegion.level === 'sigungu'
              ? getRegionNameByCodes({
                  sidoCode: mostActiveRegion.code.slice(0, 2),
                  sigunguCode: mostActiveRegion.code,
                })
              : getRegionNameByCodes({ sidoCode: mostActiveRegion.code, sigunguCode: null }),
          voteCount: mostActiveRegion.voteCount,
        }
      : null;

    const xp = totalVotes + totalGameScore;
    const level = computeLevel(xp);
    const badges = computeBadges({
      totalVotes,
      totalGameScore,
      recent7DaysTotal: recentVotes + recentGames,
      myRegionMatchRate: northstarMetrics.myRegionMatchRate,
      nationwideMatchRate: northstarMetrics.nationwideMatchRate,
      regionNationalFlow: northstarMetrics.regionNationalFlow,
    });

    const profileRegionName = getRegionNameByCodes({
      sidoCode: userRow.sido_code,
      sigunguCode: userRow.sigungu_code,
    });

    return NextResponse.json({
      profile: {
        id: userRow.id,
        name: getDisplayName(userRow),
        nickname: userRow.nickname,
        username: userRow.username ?? defaultUsername(userRow.id),
        avatarUrl: userRow.avatar_url,
        avatarPreset: userRow.avatar_preset,
        joinedAt: userRow.created_at,
        region: {
          sidoCode: userRow.sido_code,
          sigunguCode: userRow.sigungu_code,
          name: profileRegionName,
        },
      },
      northstar: northstarMetrics,
      stats: {
        totalVotes,
        totalGameScore,
        gameRankOverall,
        gameRankRegionBattle,
        recent7Days: {
          votes: recentVotes,
          games: recentGames,
          total: recentVotes + recentGames,
        },
        mostActiveRegion: mostActiveRegionPayload,
      },
      level,
      badges,
      privacy: {
        showLeaderboardName: userRow.privacy_show_leaderboard_name ?? true,
        showRegion: userRow.privacy_show_region ?? false,
        showActivityHistory: userRow.privacy_show_activity_history ?? false,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'my dashboard fetch failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
