import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getRegionNameByCodes } from '@/lib/server/region-names';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { internalServerError } from '@/lib/server/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const querySchema = z.object({
  status: z.string().trim().min(1).default('LIVE'),
  minTotalVotes: z.coerce.number().int().min(1).default(1),
});

type VoteTopicRow = {
  id: string;
  title: string;
  status: string;
};

type VoteOptionRow = {
  topic_id: string;
  option_key: string;
  option_label: string;
  position: number;
};

type RegionStatsRpcRow = {
  region: string | null;
  total: number | string | null;
  count_a: number | string | null;
  count_b: number | string | null;
};

type RegionBattleQuestion = {
  id: string;
  topicId: string;
  topicTitle: string;
  regionLevel: 'sigungu' | 'sido';
  regionCode: string;
  regionName: string;
  totalVotes: number;
  optionA: {
    key: string;
    label: string;
    percent: number;
  };
  optionB: {
    key: string;
    label: string;
    percent: number;
  };
  winner: 'A' | 'B' | 'TIE';
};

const TIE_TOLERANCE_PERCENT = 3;

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

function toWinner(countA: number, countB: number, totalVotes: number): 'A' | 'B' | 'TIE' {
  if (totalVotes <= 0) {
    return 'TIE';
  }

  const diffPercent = (Math.abs(countA - countB) / totalVotes) * 100;
  if (diffPercent <= TIE_TOLERANCE_PERCENT) {
    return 'TIE';
  }

  return countA > countB ? 'A' : 'B';
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

    const { status, minTotalVotes } = parsed.data;
    const normalizedStatus = status.toUpperCase();
    const supabase = getSupabaseServiceRoleClient();

    let topicsQuery = supabase.from('vote_topics').select('id, title, status');
    if (normalizedStatus !== 'ALL') {
      topicsQuery = topicsQuery.eq('status', normalizedStatus);
    }

    const { data: topicRows, error: topicError } = await topicsQuery;
    if (topicError) {
      return internalServerError('app/api/game/region-battle-pool/route.ts', topicError.message);
    }

    const topics = (topicRows ?? []) as VoteTopicRow[];
    if (topics.length === 0) {
      return NextResponse.json({
        items: [] as RegionBattleQuestion[],
        meta: {
          topicCount: 0,
          itemCount: 0,
        },
      });
    }

    const topicIds = topics.map((topic) => topic.id);
    const { data: optionRows, error: optionError } = await supabase
      .from('vote_options')
      .select('topic_id, option_key, option_label, position')
      .in('topic_id', topicIds)
      .order('position', { ascending: true });

    if (optionError) {
      return internalServerError('app/api/game/region-battle-pool/route.ts', optionError.message);
    }

    const optionsByTopic = new Map<string, VoteOptionRow[]>();
    ((optionRows ?? []) as VoteOptionRow[]).forEach((row) => {
      if (row.position !== 1 && row.position !== 2) {
        return;
      }
      const list = optionsByTopic.get(row.topic_id) ?? [];
      list.push(row);
      optionsByTopic.set(row.topic_id, list);
    });

    const items: RegionBattleQuestion[] = [];

    for (const topic of topics) {
      const options = optionsByTopic.get(topic.id) ?? [];
      const optionA = options.find((option) => option.position === 1);
      const optionB = options.find((option) => option.position === 2);
      if (!optionA || !optionB) {
        continue;
      }

      const sigunguResult = await supabase.rpc('get_region_vote_stats', {
        p_topic_id: topic.id,
        p_level: 'sigungu',
      });
      if (sigunguResult.error) {
        return internalServerError('app/api/game/region-battle-pool/route.ts', sigunguResult.error.message);
      }

      let rows = (Array.isArray(sigunguResult.data) ? sigunguResult.data : []) as RegionStatsRpcRow[];
      let level: 'sigungu' | 'sido' = 'sigungu';

      if (rows.length === 0) {
        const sidoResult = await supabase.rpc('get_region_vote_stats', {
          p_topic_id: topic.id,
          p_level: 'sido',
        });
        if (sidoResult.error) {
          return internalServerError('app/api/game/region-battle-pool/route.ts', sidoResult.error.message);
        }
        rows = (Array.isArray(sidoResult.data) ? sidoResult.data : []) as RegionStatsRpcRow[];
        level = 'sido';
      }

      for (const row of rows) {
        const regionCode = String(row.region ?? '').trim();
        if (!regionCode) {
          continue;
        }

        const countA = normalizeInt(row.count_a);
        const countB = normalizeInt(row.count_b);
        const totalVotes = normalizeInt(row.total) || countA + countB;
        if (totalVotes < minTotalVotes) {
          continue;
        }

        const aPercent = totalVotes > 0 ? Math.round((countA / totalVotes) * 100) : 0;
        const bPercent = totalVotes > 0 ? Math.max(0, 100 - aPercent) : 0;
        const winner = toWinner(countA, countB, totalVotes);
        const regionName =
          getRegionNameByCodes({
            sidoCode: level === 'sigungu' ? regionCode.slice(0, 2) : regionCode,
            sigunguCode: level === 'sigungu' ? regionCode : null,
          }) ?? regionCode;

        items.push({
          id: `${topic.id}:${level}:${regionCode}`,
          topicId: topic.id,
          topicTitle: topic.title,
          regionLevel: level,
          regionCode,
          regionName,
          totalVotes,
          optionA: {
            key: optionA.option_key,
            label: optionA.option_label,
            percent: aPercent,
          },
          optionB: {
            key: optionB.option_key,
            label: optionB.option_label,
            percent: bPercent,
          },
          winner,
        });
      }
    }

    return NextResponse.json({
      items,
      meta: {
        topicCount: topics.length,
        itemCount: items.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'region battle pool failed';
    return internalServerError('app/api/game/region-battle-pool/route.ts', message);
  }
}
