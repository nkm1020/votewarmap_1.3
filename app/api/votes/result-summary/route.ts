import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveSupportedCountry } from '@/lib/map/countryMapRegistry';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { resolveCountryCodeFromRequest } from '@/lib/server/country-policy';
import { getCountryRegionCentroid, getCountryRegionNameByCodes } from '@/lib/server/country-region-geo';
import { calculatePersonaPowerFromCounts, normalizePersonaTag } from '@/lib/server/persona-metrics';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { internalServerError } from '@/lib/server/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const querySchema = z.object({
  topicId: z.string().min(1),
  guestSessionId: z.string().uuid().optional(),
  country: z.string().trim().min(2).optional(),
});
const guestSessionHeaderSchema = z.string().uuid();

type RegionLevel = 'sido' | 'sigungu';

type VoteOptionRow = {
  option_key: string;
  option_label: string;
  position: number;
  persona_tag: string | null;
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

type PersonaScopeStatsRpcRow = {
  egen_count: number | string | null;
  teto_count: number | string | null;
  mapped_votes: number | string | null;
};

type ResultVisibility = 'locked' | 'unlocked';

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

function toGapPercent(countA: number, countB: number): number {
  const totalVotes = Math.max(0, countA + countB);
  if (totalVotes <= 0) {
    return 0;
  }

  const aPercent = Math.round((countA / totalVotes) * 100);
  const bPercent = Math.max(0, 100 - aPercent);
  return Math.abs(aPercent - bPercent);
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

async function loadRegionStatsMap(
  topicId: string,
  level: RegionLevel,
  countryCode: string,
): Promise<Map<string, RegionCounts>> {
  const supabase = getSupabaseServiceRoleClient();
  const { data: rpcRows, error: rpcError } = await supabase.rpc('get_region_vote_stats', {
    p_topic_id: topicId,
    p_level: level,
    p_country_code: countryCode,
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

async function loadPersonaScopeStats(
  countryCode: string,
  region:
    | {
        sidoCode: string | null;
        sigunguCode: string | null;
      }
    | null = null,
) {
  const supabase = getSupabaseServiceRoleClient();
  const { data: rpcRows, error: rpcError } = await supabase.rpc('get_persona_power_scope_stats', {
    p_country_code: countryCode,
    p_sido_code: region?.sidoCode ?? null,
    p_sigungu_code: region?.sigunguCode ?? null,
  });

  if (rpcError) {
    throw new Error(rpcError.message);
  }

  const row = (Array.isArray(rpcRows) ? rpcRows[0] : null) as PersonaScopeStatsRpcRow | null;
  return calculatePersonaPowerFromCounts({
    egenCount: normalizeInt(row?.egen_count),
    tetoCount: normalizeInt(row?.teto_count),
  });
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

    const rawGuestSessionHeader = request.headers.get('x-guest-session-id')?.trim();
    let guestSessionId = parsed.data.guestSessionId;
    if (rawGuestSessionHeader) {
      const parsedHeader = guestSessionHeaderSchema.safeParse(rawGuestSessionHeader);
      if (!parsedHeader.success) {
        return NextResponse.json(
          { error: '잘못된 guest session 헤더입니다.', details: parsedHeader.error.flatten() },
          { status: 400 },
        );
      }
      guestSessionId = parsedHeader.data;
    }

    const { topicId, country: rawCountry } = parsed.data;
    const requestedCountry = rawCountry ? resolveSupportedCountry(rawCountry) : null;
    const user = await resolveUserFromAuthorizationHeader(request.headers.get('authorization'));
    const supabase = getSupabaseServiceRoleClient();

    const { data: topicRow, error: topicError } = await supabase
      .from('vote_topics')
      .select('id, title, status')
      .eq('id', topicId)
      .maybeSingle();

    if (topicError) {
      return internalServerError('app/api/votes/result-summary/route.ts', topicError.message);
    }
    if (!topicRow) {
      return NextResponse.json({ error: '주제를 찾을 수 없습니다.' }, { status: 404 });
    }

    const { data: optionRows, error: optionsError } = await supabase
      .from('vote_options')
      .select('option_key, option_label, position, persona_tag')
      .eq('topic_id', topicId)
      .order('position', { ascending: true });

    if (optionsError) {
      return internalServerError('app/api/votes/result-summary/route.ts', optionsError.message);
    }

    const options = ((optionRows ?? []) as VoteOptionRow[])
      .filter((option) => option.position === 1 || option.position === 2)
      .map((option) => ({
        key: option.option_key,
        label: option.option_label,
        position: option.position as 1 | 2,
        personaTag: normalizePersonaTag(option.persona_tag),
      }));

    const optionA = options.find((option) => option.position === 1);
    const optionB = options.find((option) => option.position === 2);
    if (!optionA || !optionB) {
      return internalServerError('app/api/votes/result-summary/route.ts', '주제 선택지 구성이 올바르지 않습니다.');
    }

    const requestCountryCode = resolveSupportedCountry(resolveCountryCodeFromRequest(request));
    let userProfileRow:
      | {
          country_code: string | null;
          sido_code: string | null;
          sigungu_code: string | null;
        }
      | null = null;

    if (user?.id) {
      const { data: loadedUserRow, error: userRowError } = await supabase
        .from('users')
        .select('country_code, sido_code, sigungu_code')
        .eq('id', user.id)
        .maybeSingle();

      if (userRowError) {
        return internalServerError('app/api/votes/result-summary/route.ts', userRowError.message);
      }

      userProfileRow =
        (loadedUserRow as {
          country_code: string | null;
          sido_code: string | null;
          sigungu_code: string | null;
        } | null) ?? null;
    }

    const viewerCountryCode = user?.id
      ? resolveSupportedCountry(userProfileRow?.country_code)
      : requestCountryCode;
    const scopeCountryCode = requestedCountry ?? viewerCountryCode;

    const regionStatsCache = new Map<RegionLevel, Map<string, RegionCounts>>();
    const getStats = async (level: RegionLevel) => {
      const cached = regionStatsCache.get(level);
      if (cached) {
        return cached;
      }
      const loaded = await loadRegionStatsMap(topicId, level, scopeCountryCode);
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
    const nationwidePersona = await loadPersonaScopeStats(scopeCountryCode);

    let viewerType: 'user' | 'guest' | 'anonymous' = 'anonymous';
    let myOptionKey: string | null = null;
    let mySidoCode: string | null = null;
    let mySigunguCode: string | null = null;
    let voteCountryCode: string | null = null;
    let hasTopicVote = false;
    let hasVoteInScope = false;

    if (user?.id) {
      viewerType = 'user';

      const { data: voteRow, error: voteError } = await supabase
        .from('votes')
        .select('option_key, sido_code, sigungu_code, country_code')
        .eq('topic_id', topicId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (voteError) {
        return internalServerError('app/api/votes/result-summary/route.ts', voteError.message);
      }

      myOptionKey = voteRow?.option_key ?? null;
      voteCountryCode = voteRow?.country_code ? resolveSupportedCountry(voteRow.country_code) : null;
      hasTopicVote = Boolean(voteRow);
      hasVoteInScope = Boolean(voteRow) && voteCountryCode === scopeCountryCode;
      const isViewingVoteSlice = Boolean(voteRow) && voteCountryCode === scopeCountryCode;

      // 결과 비교의 지역 기준은 "유저 프로필"이 아니라 "해당 주제 투표 당시 위치"가 우선이다.
      const voteSidoCode = voteRow?.sido_code ?? null;
      const voteSigunguCode = voteRow?.sigungu_code ?? null;
      const hasVoteRegion = Boolean(voteSidoCode || voteSigunguCode);

      if (isViewingVoteSlice && hasVoteRegion) {
        mySidoCode = voteSidoCode;
        mySigunguCode = voteSigunguCode;
      } else if (isViewingVoteSlice) {
        // 과거 데이터 호환: 투표 행에 지역이 없는 경우에만 사용자 프로필 지역을 fallback으로 사용.
        mySidoCode = userProfileRow?.sido_code ?? null;
        mySigunguCode = userProfileRow?.sigungu_code ?? null;
      }
    } else if (guestSessionId) {
      viewerType = 'guest';

      const { data: guestVoteRow, error: guestVoteError } = await supabase
        .from('guest_votes_temp')
        .select('option_key, sido_code, sigungu_code, country_code')
        .eq('topic_id', topicId)
        .eq('session_id', guestSessionId)
        .maybeSingle();

      if (guestVoteError) {
        return internalServerError('app/api/votes/result-summary/route.ts', guestVoteError.message);
      }

      myOptionKey = guestVoteRow?.option_key ?? null;
      voteCountryCode = guestVoteRow?.country_code ? resolveSupportedCountry(guestVoteRow.country_code) : null;
      hasTopicVote = Boolean(guestVoteRow);
      hasVoteInScope = Boolean(guestVoteRow) && voteCountryCode === scopeCountryCode;
      if (guestVoteRow && voteCountryCode === scopeCountryCode) {
        mySidoCode = guestVoteRow.sido_code ?? null;
        mySigunguCode = guestVoteRow.sigungu_code ?? null;
      }
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
    let myRegionPersona: ReturnType<typeof calculatePersonaPowerFromCounts> | null = null;

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
      const resolvedName =
        getCountryRegionNameByCodes({
          countryCode: scopeCountryCode,
          sidoCode: mySidoCode,
          sigunguCode: mySigunguCode,
        }) ?? fallbackName;

      myRegion = {
        ...withPercent(regionStat),
        level: myRegionLevel,
        code: myRegionCode,
        name: resolvedName,
        centroid: getCountryRegionCentroid({
          countryCode: scopeCountryCode,
          level: myRegionLevel,
          regionCode: myRegionCode,
        }),
      };
      myRegionPersona = await loadPersonaScopeStats(scopeCountryCode, {
        sidoCode: mySidoCode,
        sigunguCode: mySigunguCode,
      });
    }

    const myChoiceWinner = optionKeyToWinner(myOptionKey, optionA.key, optionB.key);
    const myChoiceLabel = options.find((option) => option.key === myOptionKey)?.label ?? null;
    const matchesNationwide =
      myChoiceWinner && nationwide.winner !== 'TIE' ? myChoiceWinner === nationwide.winner : null;
    const matchesMyRegion =
      myChoiceWinner && myRegion && myRegion.winner !== 'TIE' ? myChoiceWinner === myRegion.winner : null;

    const visibility: ResultVisibility = hasVoteInScope ? 'unlocked' : 'locked';
    const preview = {
      gapPercent: toGapPercent(nationwide.countA, nationwide.countB),
      totalVotes: nationwide.totalVotes,
    };

    return NextResponse.json({
      scopeCountryCode,
      topic: {
        id: topicRow.id,
        title: topicRow.title,
        status: topicRow.status,
        optionA,
        optionB,
      },
      visibility,
      viewer: {
        type: viewerType,
        hasVote: hasTopicVote,
        hasTopicVote,
        hasVoteInScope,
        countryCode: viewerCountryCode,
        voteCountryCode,
      },
      preview: visibility === 'locked' ? preview : null,
      nationwide: visibility === 'unlocked' ? nationwide : null,
      myRegion: visibility === 'unlocked' ? myRegion : null,
      persona: {
        nationwide:
          visibility === 'unlocked'
            ? {
                egenPercent: nationwidePersona.egenPercent,
                tetoPercent: nationwidePersona.tetoPercent,
                dominant: nationwidePersona.dominant,
                mappedVotes: nationwidePersona.mappedVotes,
              }
            : null,
        myRegion:
          visibility === 'unlocked' && myRegionPersona
            ? {
                egenPercent: myRegionPersona.egenPercent,
                tetoPercent: myRegionPersona.tetoPercent,
                dominant: myRegionPersona.dominant,
                mappedVotes: myRegionPersona.mappedVotes,
              }
            : null,
      },
      myChoice:
        visibility === 'unlocked' && myOptionKey
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
    return internalServerError('app/api/votes/result-summary/route.ts', message);
  }
}
