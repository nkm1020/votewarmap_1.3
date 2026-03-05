import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { GameFactsResponse, RegionFact, SchoolFact, TopicMeta } from '@/lib/game/types';
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

type TopSchoolRpcRow = {
  region_code: string | null;
  school_id: string | null;
  school_name: string | null;
  vote_count: number | string | null;
  latitude: number | string | null;
  longitude: number | string | null;
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

function normalizeNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

function resolveRegionName(level: 'sido' | 'sigungu', regionCode: string): string {
  return (
    getRegionNameByCodes({
      sidoCode: level === 'sigungu' ? regionCode.slice(0, 2) : regionCode,
      sigunguCode: level === 'sigungu' ? regionCode : null,
    }) ?? regionCode
  );
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
      return internalServerError('app/api/game/facts/route.ts', topicError.message);
    }

    const topics = (topicRows ?? []) as VoteTopicRow[];
    if (topics.length === 0) {
      const emptyPayload: GameFactsResponse = {
        regionFacts: [],
        schoolFacts: [],
        topicMeta: [],
        meta: {
          topicCount: 0,
          regionFactCount: 0,
          schoolFactCount: 0,
        },
      };
      return NextResponse.json(emptyPayload);
    }

    const topicIds = topics.map((topic) => topic.id);
    const { data: optionRows, error: optionError } = await supabase
      .from('vote_options')
      .select('topic_id, option_key, option_label, position')
      .in('topic_id', topicIds)
      .order('position', { ascending: true });

    if (optionError) {
      return internalServerError('app/api/game/facts/route.ts', optionError.message);
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

    const topicMeta: TopicMeta[] = [];
    const regionFacts: RegionFact[] = [];

    for (const topic of topics) {
      const options = optionsByTopic.get(topic.id) ?? [];
      const optionA = options.find((option) => option.position === 1);
      const optionB = options.find((option) => option.position === 2);
      if (!optionA || !optionB) {
        continue;
      }

      topicMeta.push({
        topicId: topic.id,
        title: topic.title,
        optionAKey: optionA.option_key,
        optionALabel: optionA.option_label,
        optionBKey: optionB.option_key,
        optionBLabel: optionB.option_label,
      });

      for (const level of ['sigungu', 'sido'] as const) {
        const { data: regionRows, error: regionError } = await supabase.rpc('get_region_vote_stats', {
          p_topic_id: topic.id,
          p_level: level,
        });

        if (regionError) {
          return internalServerError('app/api/game/facts/route.ts', regionError.message);
        }

        const rows = (Array.isArray(regionRows) ? regionRows : []) as RegionStatsRpcRow[];
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
          const margin = Math.abs(aPercent - bPercent);

          regionFacts.push({
            id: `${topic.id}:${level}:${regionCode}`,
            topicId: topic.id,
            topicTitle: topic.title,
            regionCode,
            regionLevel: level,
            regionName: resolveRegionName(level, regionCode),
            totalVotes,
            optionAKey: optionA.option_key,
            optionALabel: optionA.option_label,
            optionBKey: optionB.option_key,
            optionBLabel: optionB.option_label,
            aPercent,
            bPercent,
            winner,
            margin,
          });
        }
      }
    }

    const schoolFacts: SchoolFact[] = [];

    for (const level of ['sigungu', 'sido'] as const) {
      const { data: schoolRows, error: schoolError } = await supabase.rpc('get_top_schools_by_region', {
        p_level: level,
        p_topic_id: null,
      });

      if (schoolError) {
        return internalServerError('app/api/game/facts/route.ts', schoolError.message);
      }

      ((Array.isArray(schoolRows) ? schoolRows : []) as TopSchoolRpcRow[]).forEach((row) => {
        const regionCode = String(row.region_code ?? '').trim();
        const schoolId = String(row.school_id ?? '').trim();
        const schoolName = String(row.school_name ?? '').trim();
        const voteCount = normalizeInt(row.vote_count);

        if (!regionCode || !schoolId || !schoolName || voteCount <= 0) {
          return;
        }

        schoolFacts.push({
          id: `${level}:${regionCode}:${schoolId}`,
          regionCode,
          regionLevel: level,
          regionName: resolveRegionName(level, regionCode),
          schoolId,
          schoolName,
          voteCount,
          latitude: normalizeNumber(row.latitude),
          longitude: normalizeNumber(row.longitude),
        });
      });
    }

    const payload: GameFactsResponse = {
      regionFacts,
      schoolFacts,
      topicMeta,
      meta: {
        topicCount: topicMeta.length,
        regionFactCount: regionFacts.length,
        schoolFactCount: schoolFacts.length,
      },
    };

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'game facts fetch failed';
    return internalServerError('app/api/game/facts/route.ts', message);
  }
}
