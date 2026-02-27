import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import type { RegionVoteMap } from '@/lib/vote/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const querySchema = z.object({
  topicId: z.string().trim().min(1).optional(),
  scope: z.enum(['topic', 'all']).optional(),
  level: z.enum(['sido', 'sigungu']).default('sido'),
  guestSessionId: z.string().uuid().optional(),
});

type RegionStatsRpcRow = {
  region: string | null;
  total: number | string | null;
  count_a: number | string | null;
  count_b: number | string | null;
  winner: string | null;
};

type ResultVisibility = 'locked' | 'unlocked';

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

function calculateGapPercent(countA: number, countB: number): number {
  const totalVotes = Math.max(0, countA + countB);
  if (totalVotes <= 0) {
    return 0;
  }

  const aPercent = Math.round((countA / totalVotes) * 100);
  const bPercent = Math.max(0, 100 - aPercent);
  return Math.abs(aPercent - bPercent);
}

async function resolveTopicVisibility(
  request: Request,
  topicId: string,
  guestSessionId: string | undefined,
): Promise<ResultVisibility> {
  const supabase = getSupabaseServiceRoleClient();
  const user = await resolveUserFromAuthorizationHeader(request.headers.get('authorization'));

  if (user?.id) {
    const { data: voteRow, error: voteError } = await supabase
      .from('votes')
      .select('id')
      .eq('topic_id', topicId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (voteError) {
      throw new Error(voteError.message);
    }

    return voteRow ? 'unlocked' : 'locked';
  }

  if (guestSessionId) {
    const { data: guestVoteRow, error: guestVoteError } = await supabase
      .from('guest_votes_temp')
      .select('id')
      .eq('topic_id', topicId)
      .eq('session_id', guestSessionId)
      .maybeSingle();

    if (guestVoteError) {
      throw new Error(guestVoteError.message);
    }

    return guestVoteRow ? 'unlocked' : 'locked';
  }

  return 'locked';
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

    const { level, guestSessionId } = parsed.data;
    const scope = parsed.data.scope ?? (parsed.data.topicId ? 'topic' : 'all');
    const topicId = scope === 'topic' ? parsed.data.topicId ?? null : null;
    if (scope === 'topic' && !topicId) {
      return NextResponse.json({ error: 'scope=topic 조회에는 topicId가 필요합니다.' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRoleClient();
    const visibility: ResultVisibility =
      scope === 'topic' && topicId ? await resolveTopicVisibility(request, topicId, guestSessionId) : 'locked';

    const accumulated = new Map<string, { total: number; countA: number; countB: number }>();
    const appendRows = (rows: RegionStatsRpcRow[]) => {
      rows.forEach((row) => {
        const regionCode = String(row.region ?? '').trim();
        if (!regionCode) {
          return;
        }

        const current = accumulated.get(regionCode) ?? { total: 0, countA: 0, countB: 0 };
        current.total += normalizeInt(row.total);
        current.countA += normalizeInt(row.count_a);
        current.countB += normalizeInt(row.count_b);
        accumulated.set(regionCode, current);
      });
    };

    let topicCount = 0;
    if (scope === 'topic') {
      const { data: rpcRows, error: rpcError } = await supabase.rpc('get_region_vote_stats', {
        p_topic_id: topicId,
        p_level: level,
      });

      if (rpcError) {
        return NextResponse.json({ error: rpcError.message }, { status: 500 });
      }

      appendRows((Array.isArray(rpcRows) ? rpcRows : []) as RegionStatsRpcRow[]);
      topicCount = 1;
    } else {
      const { data: topicRows, error: topicError } = await supabase
        .from('vote_topics')
        .select('id')
        .eq('status', 'LIVE');

      if (topicError) {
        return NextResponse.json({ error: topicError.message }, { status: 500 });
      }

      const topicIds = (topicRows ?? [])
        .map((row) => String(row.id ?? '').trim())
        .filter((id) => id.length > 0);
      topicCount = topicIds.length;

      if (topicIds.length > 0) {
        const rpcResults = await Promise.all(
          topicIds.map((id) =>
            supabase.rpc('get_region_vote_stats', {
              p_topic_id: id,
              p_level: level,
            }),
          ),
        );

        for (const result of rpcResults) {
          if (result.error) {
            return NextResponse.json({ error: result.error.message }, { status: 500 });
          }
          appendRows((Array.isArray(result.data) ? result.data : []) as RegionStatsRpcRow[]);
        }
      }
    }

    const statsByCode: RegionVoteMap = {};
    let totalA = 0;
    let totalB = 0;

    accumulated.forEach((value, regionCode) => {
      const winner =
        value.countA > value.countB
          ? 'A'
          : value.countB > value.countA
            ? 'B'
            : 'TIE';
      const gapPercent = calculateGapPercent(value.countA, value.countB);
      statsByCode[regionCode] =
        visibility === 'unlocked'
          ? {
              countA: value.countA,
              countB: value.countB,
              total: value.total,
              winner,
              gapPercent,
            }
          : {
              total: value.total,
              gapPercent,
            };

      totalA += value.countA;
      totalB += value.countB;
    });

    const totalVotes = totalA + totalB;
    const summary =
      visibility === 'unlocked'
        ? {
            totalVotes,
            countA: totalA,
            countB: totalB,
            gapPercent: calculateGapPercent(totalA, totalB),
          }
        : {
            totalVotes,
            gapPercent: calculateGapPercent(totalA, totalB),
          };

    const payload = {
      scope,
      level,
      visibility,
      statsByCode,
      summary,
      topicCount,
    } as const;

    if (scope === 'topic') {
      return NextResponse.json({
        ...payload,
        topicId,
      });
    }

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'region stats failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
