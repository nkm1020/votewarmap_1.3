import { randomInt } from 'node:crypto';
import { NextResponse } from 'next/server';
import { computeBadges, computeLevel } from '@/lib/me/progression';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { calculatePersonaPowerFromCounts, normalizePersonaTag } from '@/lib/server/persona-metrics';
import { getRegionNameByCodes } from '@/lib/server/region-names';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { AVATAR_PRESETS } from '@/lib/vote/constants';
import { internalServerError } from '@/lib/server/api-response';

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
  school_id: string | null;
  country_code: string | null;
  main_school_slot: SchoolSlotType | null;
  school_edit_count: number | null;
  sido_code: string | null;
  sigungu_code: string | null;
  privacy_show_leaderboard_name: boolean | null;
  privacy_show_region: boolean | null;
  privacy_show_activity_history: boolean | null;
};

type SchoolSlotType = 'middle' | 'high' | 'university' | 'graduate';

type SchoolProfileRow = {
  id: string;
  source: 'nais' | 'local_xls';
  school_code: string;
  school_name: string;
  sido_name: string | null;
  sigungu_name: string | null;
};

type MetricRpcRow = {
  my_region_match_rate: number | string | null;
  my_school_match_rate: number | string | null;
  nationwide_match_rate: number | string | null;
  dominance_gap_delta: number | string | null;
  region_national_flow: number | string | null;
  school_sample_topics: number | string | null;
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

type UserSchoolPoolRow = {
  slot_type: string;
  school_id: string;
};

type PersonaVoteRow = {
  topic_id: string;
  option_key: string;
};

type PersonaOptionRow = {
  topic_id: string;
  option_key: string;
  persona_tag: string | null;
};

type SchoolPayload = {
  id: string;
  source: 'nais' | 'local_xls';
  schoolCode: string;
  schoolName: string;
  sidoName: string | null;
  sigunguName: string | null;
  displayLabel: string;
};

function isSchoolSlotType(value: string): value is SchoolSlotType {
  return value === 'middle' || value === 'high' || value === 'university' || value === 'graduate';
}

function createEmptySchoolPool(): Record<SchoolSlotType, SchoolPayload | null> {
  return {
    middle: null,
    high: null,
    university: null,
    graduate: null,
  };
}

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

function normalizeNullableFloat(value: number | string | null | undefined): number | null {
  if (value === null || typeof value === 'undefined') {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function defaultUsername(userId: string): string {
  const compact = userId.replace(/-/g, '').slice(0, 8).toLowerCase();
  return `user_${compact}`;
}

function parseIncludeDummy(request: Request): boolean {
  const url = new URL(request.url);
  const includeDummy = url.searchParams.get('includeDummy');
  if (!includeDummy) {
    return false;
  }

  const normalized = includeDummy.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

function buildSchoolDisplayLabel(school: SchoolProfileRow): string {
  const schoolName = school.school_name?.trim();
  if (!schoolName) {
    return '';
  }

  const regionLabel = school.sigungu_name?.trim() || school.sido_name?.trim() || '';
  if (!regionLabel) {
    return schoolName;
  }
  return `${schoolName}(${regionLabel})`;
}

function mapSchoolRowToPayload(school: SchoolProfileRow): SchoolPayload {
  return {
    id: school.id,
    source: school.source,
    schoolCode: school.school_code,
    schoolName: school.school_name,
    sidoName: school.sido_name,
    sigunguName: school.sigungu_name,
    displayLabel: buildSchoolDisplayLabel(school),
  };
}

function toPersonaSummary(egenCount: number, tetoCount: number) {
  const metrics = calculatePersonaPowerFromCounts({
    egenCount,
    tetoCount,
  });

  return {
    egenPercent: metrics.egenPercent,
    tetoPercent: metrics.tetoPercent,
    dominant: metrics.dominant,
    mappedVotes: metrics.mappedVotes,
  };
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
    'id, email, full_name, nickname, username, avatar_url, avatar_preset, created_at, school_id, country_code, main_school_slot, school_edit_count, sido_code, sigungu_code, privacy_show_leaderboard_name, privacy_show_region, privacy_show_activity_history';

  const { data: existingRow, error: existingError } = await supabase
    .from('users')
    .select(selectFields)
    .eq('id', user.id)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existingRow) {
    const typedRow = existingRow as DashboardUserRow;
    if (!typedRow.avatar_preset) {
      const randomAvatarPreset = AVATAR_PRESETS[randomInt(AVATAR_PRESETS.length)] ?? AVATAR_PRESETS[0];
      const { data: updatedRow, error: updatedError } = await supabase
        .from('users')
        .update({ avatar_preset: randomAvatarPreset })
        .eq('id', user.id)
        .select(selectFields)
        .single();

      if (updatedError) {
        throw new Error(updatedError.message);
      }

      return updatedRow as DashboardUserRow;
    }

    return existingRow as DashboardUserRow;
  }

  const generatedUsername = defaultUsername(user.id);
  const randomAvatarPreset = AVATAR_PRESETS[randomInt(AVATAR_PRESETS.length)] ?? AVATAR_PRESETS[0];
  const upsertPayload = {
    id: user.id,
    email: user.email ?? null,
    full_name: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.name as string | undefined) ?? null,
    provider: (user.app_metadata?.provider as string | undefined) ?? null,
    username: generatedUsername,
    avatar_preset: randomAvatarPreset,
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
    const includeDummy = parseIncludeDummy(request);
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

    const schoolResultPromise = userRow.school_id
      ? supabase
          .from('schools')
          .select('id, source, school_code, school_name, sido_name, sigungu_name')
          .eq('id', userRow.school_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as const);

    const schoolPoolResultPromise = supabase
      .from('user_school_pool')
      .select('slot_type, school_id')
      .eq('user_id', user.id);

    const [
      schoolResult,
      schoolPoolResult,
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
      dummyVotesResult,
      dummyRecentVotesResult,
    ] = await Promise.all([
      schoolResultPromise,
      schoolPoolResultPromise,
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
      supabase.rpc('get_my_vote_comparison_metrics_segments', {
        p_user_id: user.id,
        p_include_dummy: includeDummy,
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
      includeDummy
        ? supabase
            .from('votes')
            .select('id', { count: 'exact', head: true })
            .is('user_id', null)
            .ilike('guest_token', 'dummy_%')
        : Promise.resolve({ count: 0, error: null } as const),
      includeDummy
        ? supabase
            .from('votes')
            .select('id', { count: 'exact', head: true })
            .is('user_id', null)
            .ilike('guest_token', 'dummy_%')
            .gte('created_at', sevenDaysAgoIso)
        : Promise.resolve({ count: 0, error: null } as const),
    ]);

    const queryErrors = [
      schoolResult.error,
      schoolPoolResult.error,
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
      includeDummy ? dummyVotesResult.error : null,
      includeDummy ? dummyRecentVotesResult.error : null,
    ].filter((item) => Boolean(item));

    if (queryErrors.length > 0) {
      const firstError = queryErrors[0];
      return internalServerError('app/api/me/dashboard/route.ts', firstError?.message ?? '대시보드 조회에 실패했습니다.');
    }

    const { data: myPersonaVoteRowsRaw, error: myPersonaVoteError } = await supabase
      .from('votes')
      .select('topic_id, option_key')
      .eq('user_id', user.id);

    if (myPersonaVoteError) {
      return internalServerError('app/api/me/dashboard/route.ts', myPersonaVoteError.message);
    }

    let myRegionPersonaVoteRowsRaw: PersonaVoteRow[] = [];
    if (userRow.sigungu_code || userRow.sido_code) {
      let regionVotesQuery = supabase
        .from('votes')
        .select('topic_id, option_key');

      if (userRow.sigungu_code) {
        regionVotesQuery = regionVotesQuery.eq('sigungu_code', userRow.sigungu_code);
      } else if (userRow.sido_code) {
        regionVotesQuery = regionVotesQuery.eq('sido_code', userRow.sido_code);
      }

      const { data: regionVoteRows, error: regionVoteError } = await regionVotesQuery;
      if (regionVoteError) {
        return internalServerError('app/api/me/dashboard/route.ts', regionVoteError.message);
      }
      myRegionPersonaVoteRowsRaw = (regionVoteRows ?? []) as PersonaVoteRow[];
    }

    const myPersonaVoteRows = (myPersonaVoteRowsRaw ?? []) as PersonaVoteRow[];
    const personaTopicIds = Array.from(
      new Set(
        [...myPersonaVoteRows, ...myRegionPersonaVoteRowsRaw]
          .map((row) => String(row.topic_id ?? '').trim())
          .filter((id) => id.length > 0),
      ),
    );

    let personaTagByVoteKey = new Map<string, ReturnType<typeof normalizePersonaTag>>();
    if (personaTopicIds.length > 0) {
      const { data: personaOptionRows, error: personaOptionError } = await supabase
        .from('vote_options')
        .select('topic_id, option_key, persona_tag')
        .in('topic_id', personaTopicIds);

      if (personaOptionError) {
        return internalServerError('app/api/me/dashboard/route.ts', personaOptionError.message);
      }

      personaTagByVoteKey = new Map(
        ((personaOptionRows ?? []) as PersonaOptionRow[]).map((row) => [
          `${row.topic_id}:${row.option_key}`,
          normalizePersonaTag(row.persona_tag),
        ]),
      );
    }

    const countPersonaVotes = (rows: PersonaVoteRow[]) => {
      let egenCount = 0;
      let tetoCount = 0;

      rows.forEach((row) => {
        const topicId = String(row.topic_id ?? '').trim();
        const optionKey = String(row.option_key ?? '').trim();
        if (!topicId || !optionKey) {
          return;
        }
        const personaTag = personaTagByVoteKey.get(`${topicId}:${optionKey}`) ?? null;
        if (personaTag === 'egen') {
          egenCount += 1;
        } else if (personaTag === 'teto') {
          tetoCount += 1;
        }
      });

      return { egenCount, tetoCount };
    };

    const myPersonaCounts = countPersonaVotes(myPersonaVoteRows);
    const myRegionPersonaCounts = countPersonaVotes(myRegionPersonaVoteRowsRaw);

    const personaRegionLevel: 'sido' | 'sigungu' | null = userRow.sigungu_code
      ? 'sigungu'
      : userRow.sido_code
        ? 'sido'
        : null;
    const personaRegionCode = userRow.sigungu_code ?? userRow.sido_code ?? null;
    const personaRegionName =
      personaRegionCode && personaRegionLevel
        ? getRegionNameByCodes({
            sidoCode: userRow.sido_code,
            sigunguCode: userRow.sigungu_code,
          }) ?? personaRegionCode
        : null;

    const schoolPoolRows = (schoolPoolResult.data ?? []) as UserSchoolPoolRow[];
    const schoolPoolIds = Array.from(
      new Set(
        schoolPoolRows
          .map((row) => String(row.school_id ?? '').trim())
          .filter((value) => value.length > 0),
      ),
    );

    const poolSchoolsResult =
      schoolPoolIds.length > 0
        ? await supabase
            .from('schools')
            .select('id, source, school_code, school_name, sido_name, sigungu_name')
            .in('id', schoolPoolIds)
        : ({ data: [], error: null } as const);

    if (poolSchoolsResult.error) {
      return internalServerError('app/api/me/dashboard/route.ts', poolSchoolsResult.error.message);
    }

    const schoolRowsById = new Map<string, SchoolProfileRow>();
    ((poolSchoolsResult.data ?? []) as SchoolProfileRow[]).forEach((row) => {
      schoolRowsById.set(row.id, row);
    });

    const userVotes = totalVotesResult.count ?? 0;
    const userRecentVotes = recentVotesResult.count ?? 0;
    const dummyVotes = includeDummy ? (dummyVotesResult.count ?? 0) : 0;
    const dummyRecentVotes = includeDummy ? (dummyRecentVotesResult.count ?? 0) : 0;
    const totalVotes = userVotes + dummyVotes;
    const recentVotes = userRecentVotes + dummyRecentVotes;
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
      my_school_match_rate: null,
      nationwide_match_rate: 0,
      dominance_gap_delta: 0,
      region_national_flow: 0,
      school_sample_topics: 0,
    };

    const schoolMinimumSample = 1;
    const mySchoolMatchRate = normalizeNullableFloat(northstar.my_school_match_rate);
    const schoolSampleTopics = normalizeInt(northstar.school_sample_topics);
    const northstarMetrics = {
      myRegionMatchRate: roundTwo(normalizeFloat(northstar.my_region_match_rate)),
      mySchoolMatchRate: mySchoolMatchRate === null ? null : roundTwo(mySchoolMatchRate),
      nationwideMatchRate: roundTwo(normalizeFloat(northstar.nationwide_match_rate)),
      dominanceGapDelta: roundTwo(normalizeFloat(northstar.dominance_gap_delta)),
      regionNationalFlow: roundTwo(normalizeFloat(northstar.region_national_flow)),
      schoolSampleTopics,
      schoolEligible: Boolean(userRow.school_id) && schoolSampleTopics >= schoolMinimumSample,
      schoolMinimumSample,
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
    const schoolRow = (schoolResult.data as SchoolProfileRow | null) ?? null;
    const schoolPayload = schoolRow ? mapSchoolRowToPayload(schoolRow) : null;
    const schoolPoolPayload = createEmptySchoolPool();
    schoolPoolRows.forEach((row) => {
      const slotType = String(row.slot_type ?? '').trim();
      if (!isSchoolSlotType(slotType)) {
        return;
      }
      const schoolId = String(row.school_id ?? '').trim();
      if (!schoolId) {
        return;
      }
      const poolSchoolRow = schoolRowsById.get(schoolId);
      if (!poolSchoolRow) {
        return;
      }
      schoolPoolPayload[slotType] = mapSchoolRowToPayload(poolSchoolRow);
    });
    const schoolEditUsed = Math.max(0, normalizeInt(userRow.school_edit_count));
    const schoolEditLimit = 2;

    return NextResponse.json({
      profile: {
        id: userRow.id,
        name: getDisplayName(userRow),
        nickname: userRow.nickname,
        username: userRow.username ?? defaultUsername(userRow.id),
        avatarUrl: userRow.avatar_url,
        avatarPreset: userRow.avatar_preset,
        countryCode: userRow.country_code ?? 'KR',
        joinedAt: userRow.created_at,
        region: {
          sidoCode: userRow.sido_code,
          sigunguCode: userRow.sigungu_code,
          name: profileRegionName,
        },
        school: schoolPayload,
        schoolPool: schoolPoolPayload,
        mainSchoolSlot: userRow.main_school_slot,
        schoolEdit: {
          used: schoolEditUsed,
          limit: schoolEditLimit,
          remaining: Math.max(0, schoolEditLimit - schoolEditUsed),
        },
      },
      northstar: northstarMetrics,
      personaPower: {
        my: toPersonaSummary(myPersonaCounts.egenCount, myPersonaCounts.tetoCount),
        myRegion: {
          ...toPersonaSummary(myRegionPersonaCounts.egenCount, myRegionPersonaCounts.tetoCount),
          regionLevel: personaRegionLevel,
          regionCode: personaRegionCode,
          regionName: personaRegionName,
        },
      },
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
    return internalServerError('app/api/me/dashboard/route.ts', message);
  }
}
