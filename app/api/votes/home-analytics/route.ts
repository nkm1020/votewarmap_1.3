import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import type { AgeBucketKey, HomeAnalyticsResponse } from '@/lib/vote/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const querySchema = z.object({
  status: z.string().trim().min(1).default('LIVE'),
});

type LiveVoteDemographicsRow = {
  total_member_votes: number | string | null;
  male_count: number | string | null;
  female_count: number | string | null;
  other_count: number | string | null;
  unknown_gender_count: number | string | null;
  teens_count: number | string | null;
  twenties_count: number | string | null;
  thirties_count: number | string | null;
  forties_count: number | string | null;
  fifties_plus_count: number | string | null;
  unknown_age_count: number | string | null;
  reference_year: number | string | null;
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

function toPercent(count: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return Math.round((count / denominator) * 1000) / 10;
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

    const { status } = parsed.data;
    const supabase = getSupabaseServiceRoleClient();
    const { data: rows, error } = await supabase.rpc('get_live_vote_demographics', {
      p_status: status,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const row = (Array.isArray(rows) ? rows[0] : null) as LiveVoteDemographicsRow | null;

    const totalMemberVotes = normalizeInt(row?.total_member_votes);
    const maleCount = normalizeInt(row?.male_count);
    const femaleCount = normalizeInt(row?.female_count);
    const otherCount = normalizeInt(row?.other_count);
    const unknownGenderCount = normalizeInt(row?.unknown_gender_count);
    const teensCount = normalizeInt(row?.teens_count);
    const twentiesCount = normalizeInt(row?.twenties_count);
    const thirtiesCount = normalizeInt(row?.thirties_count);
    const fortiesCount = normalizeInt(row?.forties_count);
    const fiftiesPlusCount = normalizeInt(row?.fifties_plus_count);
    const unknownAgeCount = normalizeInt(row?.unknown_age_count);
    const referenceYear = normalizeInt(row?.reference_year) || new Date().getFullYear();

    const ageKnownTotal = teensCount + twentiesCount + thirtiesCount + fortiesCount + fiftiesPlusCount;
    const genderKnownBinaryTotal = maleCount + femaleCount;

    const ageBuckets: Record<AgeBucketKey, { count: number; percent: number }> = {
      teens: { count: teensCount, percent: toPercent(teensCount, ageKnownTotal) },
      twenties: { count: twentiesCount, percent: toPercent(twentiesCount, ageKnownTotal) },
      thirties: { count: thirtiesCount, percent: toPercent(thirtiesCount, ageKnownTotal) },
      forties: { count: fortiesCount, percent: toPercent(fortiesCount, ageKnownTotal) },
      fiftiesPlus: { count: fiftiesPlusCount, percent: toPercent(fiftiesPlusCount, ageKnownTotal) },
    };

    const payload: HomeAnalyticsResponse = {
      demographics: {
        source: 'votes_members_only',
        scope: status,
        totalMemberVotes,
        age: {
          buckets: ageBuckets,
          knownTotal: ageKnownTotal,
          unknownCount: unknownAgeCount,
          referenceYear,
        },
        gender: {
          male: {
            count: maleCount,
            percent: toPercent(maleCount, genderKnownBinaryTotal),
          },
          female: {
            count: femaleCount,
            percent: toPercent(femaleCount, genderKnownBinaryTotal),
          },
          otherCount,
          unknownCount: unknownGenderCount,
          knownBinaryTotal: genderKnownBinaryTotal,
        },
      },
    };

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'home analytics fetch failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
