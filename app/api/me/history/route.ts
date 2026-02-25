import { NextResponse } from 'next/server';
import { computeBadges } from '@/lib/me/progression';
import { getPublicGameFormats } from '@/lib/game/formats';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { getRegionNameByCodes } from '@/lib/server/region-names';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

type VoteRow = {
  id: string;
  topic_id: string;
  option_key: string;
  sido_code: string | null;
  sigungu_code: string | null;
  created_at: string;
};

type VoteTopicRow = {
  id: string;
  title: string;
};

type VoteOptionRow = {
  topic_id: string;
  option_key: string;
  option_label: string;
};

type ModeGameRow = {
  id: string;
  mode_id: string;
  raw_score: number;
  normalized_score: number;
  played_at: string;
};

type RegionBattleGameRow = {
  id: string;
  score: number;
  played_at: string;
};

type MetricRpcRow = {
  my_region_match_rate: number | string | null;
  nationwide_match_rate: number | string | null;
  region_national_flow: number | string | null;
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

export async function GET(request: Request) {
  try {
    const user = await resolveUserFromAuthorizationHeader(request.headers.get('authorization'));
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const supabase = getSupabaseServiceRoleClient();
    const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [votesResult, modeGamesResult, regionBattleResult, northstarMetricResult] = await Promise.all([
      supabase
        .from('votes')
        .select('id, topic_id, option_key, sido_code, sigungu_code, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('game_mode_scores')
        .select('id, mode_id, raw_score, normalized_score, played_at')
        .eq('user_id', user.id)
        .order('played_at', { ascending: false }),
      supabase
        .from('region_battle_game_scores')
        .select('id, score, played_at')
        .eq('user_id', user.id)
        .order('played_at', { ascending: false }),
      supabase.rpc('get_my_vote_comparison_metrics', {
        p_user_id: user.id,
      }),
    ]);

    const topLevelErrors = [votesResult.error, modeGamesResult.error, regionBattleResult.error, northstarMetricResult.error].filter(
      (item) => Boolean(item),
    );

    if (topLevelErrors.length > 0) {
      const firstError = topLevelErrors[0];
      return NextResponse.json({ error: firstError?.message ?? '내 활동 기록 조회에 실패했습니다.' }, { status: 500 });
    }

    const voteRows = (votesResult.data ?? []) as VoteRow[];
    const modeGameRows = (modeGamesResult.data ?? []) as ModeGameRow[];
    const regionBattleRows = (regionBattleResult.data ?? []) as RegionBattleGameRow[];

    const topicIds = Array.from(new Set(voteRows.map((item) => item.topic_id).filter((item) => item.length > 0)));

    let topicById = new Map<string, VoteTopicRow>();
    let optionLabelByKey = new Map<string, string>();

    if (topicIds.length > 0) {
      const [{ data: topicRows, error: topicsError }, { data: optionRows, error: optionsError }] = await Promise.all([
        supabase.from('vote_topics').select('id, title').in('id', topicIds),
        supabase.from('vote_options').select('topic_id, option_key, option_label').in('topic_id', topicIds),
      ]);

      if (topicsError) {
        return NextResponse.json({ error: topicsError.message }, { status: 500 });
      }

      if (optionsError) {
        return NextResponse.json({ error: optionsError.message }, { status: 500 });
      }

      topicById = new Map(((topicRows ?? []) as VoteTopicRow[]).map((row) => [row.id, row]));
      optionLabelByKey = new Map(
        ((optionRows ?? []) as VoteOptionRow[]).map((row) => [`${row.topic_id}:${row.option_key}`, row.option_label]),
      );
    }

    const votes = voteRows.map((row) => {
      const sigunguCode = String(row.sigungu_code ?? '').trim();
      const sidoCode = String(row.sido_code ?? '').trim();
      const level = sigunguCode ? 'sigungu' : 'sido';
      const code = sigunguCode || sidoCode;

      return {
        id: row.id,
        topicId: row.topic_id,
        topicTitle: topicById.get(row.topic_id)?.title ?? row.topic_id,
        optionKey: row.option_key,
        optionLabel: optionLabelByKey.get(`${row.topic_id}:${row.option_key}`) ?? row.option_key,
        votedAt: row.created_at,
        region: code
          ? {
              level,
              code,
              name:
                level === 'sigungu'
                  ? getRegionNameByCodes({ sidoCode: code.slice(0, 2), sigunguCode: code })
                  : getRegionNameByCodes({ sidoCode: code, sigunguCode: null }),
            }
          : null,
      };
    });

    const modeLabelById = new Map<string, string>(
      getPublicGameFormats().map((format) => [format.id, format.label]),
    );

    const games = [
      ...modeGameRows.map((row) => ({
        id: row.id,
        source: 'mode' as const,
        modeId: row.mode_id,
        modeLabel: modeLabelById.get(row.mode_id) ?? row.mode_id,
        rawScore: normalizeInt(row.raw_score),
        normalizedScore: normalizeInt(row.normalized_score),
        playedAt: row.played_at,
      })),
      ...regionBattleRows.map((row) => ({
        id: row.id,
        source: 'region_battle' as const,
        modeId: 'region_battle',
        modeLabel: '지역 배틀',
        rawScore: normalizeInt(row.score),
        normalizedScore: Math.min(100, normalizeInt(row.score)),
        playedAt: row.played_at,
      })),
    ].sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt));

    const bestModeById = new Map<string, number>();
    modeGameRows.forEach((row) => {
      const previous = bestModeById.get(row.mode_id) ?? 0;
      const next = normalizeInt(row.normalized_score);
      if (next > previous) {
        bestModeById.set(row.mode_id, next);
      }
    });
    const modeScoreSum = Array.from(bestModeById.values()).reduce((sum, value) => sum + value, 0);
    const bestRegionBattleRawScore = regionBattleRows.reduce((max, row) => Math.max(max, normalizeInt(row.score)), 0);
    const totalGameScore = modeScoreSum + Math.min(100, bestRegionBattleRawScore);

    const recentVotes = voteRows.filter((row) => Date.parse(row.created_at) >= Date.parse(sevenDaysAgoIso)).length;
    const recentModeGames = modeGameRows.filter((row) => Date.parse(row.played_at) >= Date.parse(sevenDaysAgoIso)).length;
    const recentRegionBattleGames = regionBattleRows.filter(
      (row) => Date.parse(row.played_at) >= Date.parse(sevenDaysAgoIso),
    ).length;

    const northstarRows = (Array.isArray(northstarMetricResult.data)
      ? northstarMetricResult.data
      : []) as MetricRpcRow[];
    const northstar = northstarRows[0] ?? {
      my_region_match_rate: 0,
      nationwide_match_rate: 0,
      region_national_flow: 0,
    };

    const badges = computeBadges({
      totalVotes: voteRows.length,
      totalGameScore,
      recent7DaysTotal: recentVotes + recentModeGames + recentRegionBattleGames,
      myRegionMatchRate: normalizeFloat(northstar.my_region_match_rate),
      nationwideMatchRate: normalizeFloat(northstar.nationwide_match_rate),
      regionNationalFlow: normalizeFloat(northstar.region_national_flow),
    });

    return NextResponse.json({
      votes,
      games,
      badges,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'my history fetch failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
