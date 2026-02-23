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

type RegionStatsRpcRow = {
  region: string | null;
  total: number | string | null;
  count_a: number | string | null;
  count_b: number | string | null;
  winner: string | null;
};

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

    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    const statsByCode: RegionVoteMap = {};
    let totalA = 0;
    let totalB = 0;

    (Array.isArray(rpcRows) ? rpcRows : []).forEach((row) => {
      const typedRow = row as RegionStatsRpcRow;
      const regionCode = String(typedRow.region ?? '').trim();
      if (!regionCode) {
        return;
      }

      const countA = normalizeInt(typedRow.count_a);
      const countB = normalizeInt(typedRow.count_b);
      const total = normalizeInt(typedRow.total);
      const winner =
        typedRow.winner === 'A' || typedRow.winner === 'B' || typedRow.winner === 'TIE'
          ? typedRow.winner
          : 'TIE';

      statsByCode[regionCode] = {
        countA,
        countB,
        total,
        winner,
      };

      totalA += countA;
      totalB += countB;
    });

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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'region stats failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
