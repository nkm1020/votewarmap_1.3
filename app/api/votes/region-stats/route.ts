import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import type { RegionVoteMap } from '@/lib/vote/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const querySchema = z.object({
  topicId: z.string().min(1),
  level: z.enum(['sido', 'sigungu']).default('sido'),
});

type VoteOptionRow = {
  option_key: string;
  position: number;
};

type RegionStatsRpcRow = {
  region: string | null;
  total: number | string | null;
  count_a: number | string | null;
  count_b: number | string | null;
  winner: string | null;
};

type VoteRow = {
  option_key: string;
  sido_code: string | null;
  sigungu_code: string | null;
  school:
    | {
        sido_code: string | null;
        sigungu_code: string | null;
      }
    | Array<{
        sido_code: string | null;
        sigungu_code: string | null;
      }>
    | null;
};

async function fetchAllVotesByTopic(topicId: string): Promise<VoteRow[]> {
  const supabase = getSupabaseServiceRoleClient();
  const pageSize = 1000;
  const collected: VoteRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('votes')
      .select('option_key, sido_code, sigungu_code, school:schools!votes_school_id_fkey(sido_code, sigungu_code)')
      .eq('topic_id', topicId)
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(error.message);
    }

    const rows = (data ?? []) as VoteRow[];
    collected.push(...rows);
    if (rows.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return collected;
}

function normalizeInt(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeCode(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveSchoolCode(
  school: VoteRow['school'],
): { sido_code: string | null; sigungu_code: string | null } | null {
  if (!school) {
    return null;
  }

  if (Array.isArray(school)) {
    return school[0] ?? null;
  }

  return school;
}

function buildStatsFromVoteRows(
  rows: VoteRow[],
  level: 'sido' | 'sigungu',
  optionA: string,
  optionB: string,
): {
  statsByCode: RegionVoteMap;
  summary: { totalVotes: number; countA: number; countB: number };
} {
  const statsByCode: RegionVoteMap = {};
  let totalA = 0;
  let totalB = 0;

  rows.forEach((row) => {
    const linkedSchool = resolveSchoolCode(row.school);
    const regionCodeRaw =
      level === 'sigungu'
        ? row.sigungu_code ?? linkedSchool?.sigungu_code ?? null
        : row.sido_code ?? linkedSchool?.sido_code ?? null;
    const regionCode = normalizeCode(regionCodeRaw);
    if (!regionCode) {
      return;
    }

    const current = statsByCode[regionCode] ?? { total: 0, countA: 0, countB: 0, winner: 'TIE' as const };
    const nextCountA = (current.countA ?? 0) + (row.option_key === optionA ? 1 : 0);
    const nextCountB = (current.countB ?? 0) + (row.option_key === optionB ? 1 : 0);
    const nextTotal = (current.total ?? 0) + 1;

    statsByCode[regionCode] = {
      countA: nextCountA,
      countB: nextCountB,
      total: nextTotal,
      winner: nextCountA > nextCountB ? 'A' : nextCountB > nextCountA ? 'B' : 'TIE',
    };

    if (row.option_key === optionA) {
      totalA += 1;
    } else if (row.option_key === optionB) {
      totalB += 1;
    }
  });

  return {
    statsByCode,
    summary: {
      totalVotes: totalA + totalB,
      countA: totalA,
      countB: totalB,
    },
  };
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

    const { topicId, level } = parsed.data;
    const supabase = getSupabaseServiceRoleClient();

    const { data: rpcRows, error: rpcError } = await supabase.rpc('get_region_vote_stats', {
      p_topic_id: topicId,
      p_level: level,
    });

    if (!rpcError && Array.isArray(rpcRows)) {
      const statsByCode: RegionVoteMap = {};
      let totalA = 0;
      let totalB = 0;

      (rpcRows as RegionStatsRpcRow[]).forEach((row) => {
        const regionCode = String(row.region ?? '').trim();
        if (!regionCode) {
          return;
        }

        const countA = normalizeInt(row.count_a);
        const countB = normalizeInt(row.count_b);
        const total = normalizeInt(row.total);
        const winner = row.winner === 'A' || row.winner === 'B' || row.winner === 'TIE' ? row.winner : 'TIE';

        statsByCode[regionCode] = {
          countA,
          countB,
          total,
          winner,
        };

        totalA += countA;
        totalB += countB;
      });

      const hasRpcStats = Object.keys(statsByCode).length > 0;
      if (hasRpcStats) {
        return NextResponse.json({
          topicId,
          level,
          statsByCode,
          summary: {
            totalVotes: totalA + totalB,
            countA: totalA,
            countB: totalB,
          },
        });
      }
    }

    const { data: optionRows, error: optionError } = await supabase
      .from('vote_options')
      .select('option_key, position')
      .eq('topic_id', topicId)
      .order('position', { ascending: true });

    if (optionError) {
      return NextResponse.json({ error: optionError.message }, { status: 500 });
    }

    const options = (optionRows ?? []) as VoteOptionRow[];
    const optionA = options.find((item) => item.position === 1)?.option_key;
    const optionB = options.find((item) => item.position === 2)?.option_key;
    if (!optionA || !optionB) {
      return NextResponse.json({ error: '투표 선택지 정보를 찾을 수 없습니다.' }, { status: 400 });
    }

    const rows = await fetchAllVotesByTopic(topicId);
    const { statsByCode, summary } = buildStatsFromVoteRows(rows, level, optionA, optionB);

    return NextResponse.json({
      topicId,
      level,
      statsByCode,
      summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'region stats failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
