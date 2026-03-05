import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getRegionCentroid } from '@/lib/server/region-centroids';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { internalServerError } from '@/lib/server/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const querySchema = z.object({
  scope: z.enum(['all', 'topic']).default('all'),
  topicId: z.string().trim().min(1).optional(),
});

type TopSchoolRpcRow = {
  region_code: string | null;
  school_id: string | null;
  school_name: string | null;
  vote_count: number | string | null;
  last_vote_at: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  sigungu_code: string | null;
};

type TopSchoolMarker = {
  id: string;
  name: string;
  rankLevel: 'sido';
  regionCode: string;
  schoolId: string;
  voteCount: number;
  lastVoteAt: string;
  lat: number;
  lng: number;
  coordinateSource: 'school' | 'centroid';
};

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

function isValidLatLng(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
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

    const { scope, topicId } = parsed.data;
    if (scope === 'topic' && !topicId) {
      return NextResponse.json({ error: 'scope=topic 조회에는 topicId가 필요합니다.' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRoleClient();
    const { data: rpcRows, error: rpcError } = await supabase.rpc('get_top_schools_by_region', {
      p_level: 'sido',
      p_topic_id: scope === 'topic' ? topicId : null,
    });

    if (rpcError) {
      return internalServerError('app/api/votes/top-schools-by-region/route.ts', rpcError.message);
    }

    const markers: TopSchoolMarker[] = [];

    (Array.isArray(rpcRows) ? rpcRows : []).forEach((row) => {
      const typedRow = row as TopSchoolRpcRow;
      const regionCode = String(typedRow.region_code ?? '').trim();
      const schoolId = String(typedRow.school_id ?? '').trim();
      const schoolName = String(typedRow.school_name ?? '').trim();
      const voteCount = normalizeNumber(typedRow.vote_count);
      const lastVoteAt = String(typedRow.last_vote_at ?? '').trim();

      if (!regionCode || !schoolId || !schoolName || voteCount === null || !lastVoteAt) {
        return;
      }

      if (!Number.isFinite(Date.parse(lastVoteAt))) {
        return;
      }

      let lat = normalizeNumber(typedRow.latitude);
      let lng = normalizeNumber(typedRow.longitude);
      let coordinateSource: 'school' | 'centroid' = 'school';

      if (lat === null || lng === null || !isValidLatLng(lat, lng)) {
        const sigunguCode = String(typedRow.sigungu_code ?? '').trim();
        const centroid =
          (sigunguCode ? getRegionCentroid('sigungu', sigunguCode) : null) ??
          getRegionCentroid('sido', regionCode);
        if (!centroid) {
          return;
        }
        lat = centroid.lat;
        lng = centroid.lng;
        coordinateSource = 'centroid';
      }

      markers.push({
        id: `${regionCode}:${schoolId}`,
        name: schoolName,
        rankLevel: 'sido',
        regionCode,
        schoolId,
        voteCount: Math.max(0, Math.round(voteCount)),
        lastVoteAt,
        lat,
        lng,
        coordinateSource,
      });
    });

    return NextResponse.json({ markers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'top schools by region failed';
    return internalServerError('app/api/votes/top-schools-by-region/route.ts', message);
  }
}
