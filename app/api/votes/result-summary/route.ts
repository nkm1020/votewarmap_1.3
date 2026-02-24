import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { getRegionCentroid } from '@/lib/server/region-centroids';
import { getRegionNameByCodes } from '@/lib/server/region-names';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const querySchema = z.object({
  topicId: z.string().min(1),
  guestSessionId: z.string().uuid().optional(),
});

type RegionLevel = 'sido' | 'sigungu';

type VoteOptionRow = {
  option_key: string;
  option_label: string;
  position: number;
};

type RegionStatsRpcRow = {
  region: string | null;
  total: number | string | null;
  count_a: number | string | null;
  count_b: number | string | null;
  winner: string | null;
};

type RegionCounts = {
  countA: number;
  countB: number;
  totalVotes: number;
  winner: 'A' | 'B' | 'TIE';
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

function toWinner(countA: number, countB: number): 'A' | 'B' | 'TIE' {
  if (countA === countB) {
    return 'TIE';
  }
  return countA > countB ? 'A' : 'B';
}

function withPercent(stat: RegionCounts) {
  const total = stat.totalVotes;
  if (total <= 0) {
    return {
      ...stat,
      aPercent: 0,
      bPercent: 0,
    };
  }

  const aPercent = Math.round((stat.countA / total) * 100);
  return {
    ...stat,
    aPercent,
    bPercent: Math.max(0, 100 - aPercent),
  };
}

function optionKeyToWinner(optionKey: string | null, optionAKey: string, optionBKey: string): 'A' | 'B' | null {
  if (!optionKey) {
    return null;
  }
  if (optionKey === optionAKey) {
    return 'A';
  }
  if (optionKey === optionBKey) {
    return 'B';
  }
  return null;
}

async function loadRegionStatsMap(topicId: string, level: RegionLevel): Promise<Map<string, RegionCounts>> {
  const supabase = getSupabaseServiceRoleClient();
  const { data: rpcRows, error: rpcError } = await supabase.rpc('get_region_vote_stats', {
    p_topic_id: topicId,
    p_level: level,
  });

  if (rpcError) {
    throw new Error(rpcError.message);
  }

  const map = new Map<string, RegionCounts>();
  (Array.isArray(rpcRows) ? rpcRows : []).forEach((row) => {
    const typed = row as RegionStatsRpcRow;
    const code = String(typed.region ?? '').trim();
    if (!code) {
      return;
    }

    const countA = normalizeInt(typed.count_a);
    const countB = normalizeInt(typed.count_b);
    const totalVotes = normalizeInt(typed.total);
    const winner = toWinner(countA, countB);
    map.set(code, { countA, countB, totalVotes, winner });
  });

  return map;
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

    const { topicId, guestSessionId } = parsed.data;
    const user = await resolveUserFromAuthorizationHeader(request.headers.get('authorization'));
    const supabase = getSupabaseServiceRoleClient();

    const { data: topicRow, error: topicError } = await supabase
      .from('vote_topics')
      .select('id, title, status')
      .eq('id', topicId)
      .maybeSingle();

    if (topicError) {
      return NextResponse.json({ error: topicError.message }, { status: 500 });
    }
    if (!topicRow) {
      return NextResponse.json({ error: '주제를 찾을 수 없습니다.' }, { status: 404 });
    }

    const { data: optionRows, error: optionsError } = await supabase
      .from('vote_options')
      .select('option_key, option_label, position')
      .eq('topic_id', topicId)
      .order('position', { ascending: true });

    if (optionsError) {
      return NextResponse.json({ error: optionsError.message }, { status: 500 });
    }

    const options = ((optionRows ?? []) as VoteOptionRow[])
      .filter((option) => option.position === 1 || option.position === 2)
      .map((option) => ({
        key: option.option_key,
        label: option.option_label,
        position: option.position as 1 | 2,
      }));

    const optionA = options.find((option) => option.position === 1);
    const optionB = options.find((option) => option.position === 2);
    if (!optionA || !optionB) {
      return NextResponse.json({ error: '주제 선택지 구성이 올바르지 않습니다.' }, { status: 500 });
    }

    const regionStatsCache = new Map<RegionLevel, Map<string, RegionCounts>>();
    const getStats = async (level: RegionLevel) => {
      const cached = regionStatsCache.get(level);
      if (cached) {
        return cached;
      }
      const loaded = await loadRegionStatsMap(topicId, level);
      regionStatsCache.set(level, loaded);
      return loaded;
    };

    const nationwideStatsMap = await getStats('sido');
    let nationalCountA = 0;
    let nationalCountB = 0;
    nationwideStatsMap.forEach((stat) => {
      nationalCountA += stat.countA;
      nationalCountB += stat.countB;
    });

    const nationwide = withPercent({
      countA: nationalCountA,
      countB: nationalCountB,
      totalVotes: nationalCountA + nationalCountB,
      winner: toWinner(nationalCountA, nationalCountB),
    });

    let viewerType: 'user' | 'guest' | 'anonymous' = 'anonymous';
    let myOptionKey: string | null = null;
    let mySidoCode: string | null = null;
    let mySigunguCode: string | null = null;

    if (user?.id) {
      viewerType = 'user';

      const [{ data: voteRow, error: voteError }, { data: userRow, error: userRowError }] = await Promise.all([
        supabase
          .from('votes')
          .select('option_key, sido_code, sigungu_code')
          .eq('topic_id', topicId)
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('users')
          .select('sido_code, sigungu_code')
          .eq('id', user.id)
          .maybeSingle(),
      ]);

      if (voteError) {
        return NextResponse.json({ error: voteError.message }, { status: 500 });
      }
      if (userRowError) {
        return NextResponse.json({ error: userRowError.message }, { status: 500 });
      }

      myOptionKey = voteRow?.option_key ?? null;
      // 결과 비교의 지역 기준은 "유저 프로필"이 아니라 "해당 주제 투표 당시 위치"가 우선이다.
      const voteSidoCode = voteRow?.sido_code ?? null;
      const voteSigunguCode = voteRow?.sigungu_code ?? null;
      const hasVoteRegion = Boolean(voteSidoCode || voteSigunguCode);

      if (hasVoteRegion) {
        mySidoCode = voteSidoCode;
        mySigunguCode = voteSigunguCode;
      } else {
        // 과거 데이터 호환: 투표 행에 지역이 없는 경우에만 사용자 프로필 지역을 fallback으로 사용.
        mySidoCode = userRow?.sido_code ?? null;
        mySigunguCode = userRow?.sigungu_code ?? null;
      }
    } else if (guestSessionId) {
      viewerType = 'guest';

      const { data: guestVoteRow, error: guestVoteError } = await supabase
        .from('guest_votes_temp')
        .select('option_key, sido_code, sigungu_code')
        .eq('topic_id', topicId)
        .eq('session_id', guestSessionId)
        .maybeSingle();

      if (guestVoteError) {
        return NextResponse.json({ error: guestVoteError.message }, { status: 500 });
      }

      myOptionKey = guestVoteRow?.option_key ?? null;
      mySidoCode = guestVoteRow?.sido_code ?? null;
      mySigunguCode = guestVoteRow?.sigungu_code ?? null;
    }

    const myRegionLevel: RegionLevel | null = mySigunguCode ? 'sigungu' : mySidoCode ? 'sido' : null;
    const myRegionCode = mySigunguCode ?? mySidoCode;

    let myRegion:
      | (ReturnType<typeof withPercent> & {
          level: RegionLevel;
          code: string;
          name: string;
          centroid: {
            lat: number;
            lng: number;
          } | null;
        })
      | null = null;

    if (myRegionLevel && myRegionCode) {
      const statsMap = await getStats(myRegionLevel);
      const regionStat =
        statsMap.get(myRegionCode) ??
        ({
          countA: 0,
          countB: 0,
          totalVotes: 0,
          winner: 'TIE',
        } as RegionCounts);

      const fallbackName = myRegionLevel === 'sigungu' ? myRegionCode : mySidoCode ?? myRegionCode;
      const resolvedName = getRegionNameByCodes({ sidoCode: mySidoCode, sigunguCode: mySigunguCode }) ?? fallbackName;

      myRegion = {
        ...withPercent(regionStat),
        level: myRegionLevel,
        code: myRegionCode,
        name: resolvedName,
        centroid: getRegionCentroid(myRegionLevel, myRegionCode),
      };
    }

    const myChoiceWinner = optionKeyToWinner(myOptionKey, optionA.key, optionB.key);
    const myChoiceLabel = options.find((option) => option.key === myOptionKey)?.label ?? null;
    const matchesNationwide =
      myChoiceWinner && nationwide.winner !== 'TIE' ? myChoiceWinner === nationwide.winner : null;
    const matchesMyRegion =
      myChoiceWinner && myRegion && myRegion.winner !== 'TIE' ? myChoiceWinner === myRegion.winner : null;

    return NextResponse.json({
      topic: {
        id: topicRow.id,
        title: topicRow.title,
        status: topicRow.status,
        optionA,
        optionB,
      },
      viewer: {
        type: viewerType,
        hasVote: Boolean(myOptionKey),
      },
      nationwide,
      myRegion,
      myChoice: myOptionKey
        ? {
            optionKey: myOptionKey,
            label: myChoiceLabel,
            matchesNationwide,
            matchesMyRegion,
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'result summary failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
