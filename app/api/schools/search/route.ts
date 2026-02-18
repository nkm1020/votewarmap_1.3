import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { resolveSidoCode, resolveSigunguCode } from '@/lib/server/regions';
import type { SchoolLevel, SchoolSearchItem } from '@/lib/vote/types';

export const runtime = 'nodejs';

const searchSchema = z.object({
  q: z.string().trim().min(1),
  level: z.enum(['middle', 'high', 'university', 'graduate', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(30).default(10),
});

type LocalSchoolRow = {
  id: string;
  source: 'nais' | 'local_xls';
  school_code: string;
  school_name: string;
  school_level: SchoolLevel;
  campus_type: string | null;
  parent_school_id: string | null;
  sido_name: string | null;
  sido_code: string | null;
  sigungu_name: string | null;
  sigungu_code: string | null;
  address: string | null;
  is_active: boolean;
};

function mapNaisSchoolLevel(kind: string | null | undefined): SchoolLevel | null {
  if (!kind) {
    return null;
  }

  if (kind === '중학교') {
    return 'middle';
  }

  if (kind === '고등학교') {
    return 'high';
  }

  return null;
}

function mapLocalRowToItem(row: LocalSchoolRow): SchoolSearchItem {
  return {
    id: row.id,
    source: row.source,
    schoolCode: row.school_code,
    schoolName: row.school_name,
    schoolLevel: row.school_level,
    campusType: row.campus_type,
    parentSchoolId: row.parent_school_id,
    sidoName: row.sido_name,
    sidoCode: row.sido_code,
    sigunguName: row.sigungu_name,
    sigunguCode: row.sigungu_code,
    address: row.address,
    isActive: row.is_active,
  };
}

async function searchLocalSchools(params: { q: string; level: string; limit: number }): Promise<SchoolSearchItem[]> {
  const { q, level, limit } = params;
  const localLevels = level === 'all' ? ['university', 'graduate'] : [level];
  if (!localLevels.some((item) => item === 'university' || item === 'graduate')) {
    return [];
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('schools')
    .select(
      'id, source, school_code, school_name, school_level, campus_type, parent_school_id, sido_name, sido_code, sigungu_name, sigungu_code, address, is_active',
    )
    .eq('source', 'local_xls')
    .in('school_level', localLevels.filter((item) => item === 'university' || item === 'graduate'))
    .ilike('school_name', `%${q}%`)
    .order('school_name', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapLocalRowToItem(row as LocalSchoolRow));
}

async function searchNaisSchools(params: { q: string; level: string; limit: number }): Promise<SchoolSearchItem[]> {
  const { q, level, limit } = params;
  const needsMiddle = level === 'all' || level === 'middle';
  const needsHigh = level === 'all' || level === 'high';
  if (!needsMiddle && !needsHigh) {
    return [];
  }

  const apiKey = process.env.NEIS_API_KEY;
  if (!apiKey) {
    return [];
  }

  const searchParams = new URLSearchParams({
    KEY: apiKey,
    Type: 'json',
    pIndex: '1',
    pSize: String(Math.min(Math.max(limit * 3, 20), 100)),
    SCHUL_NM: q,
  });

  const response = await fetch(`https://open.neis.go.kr/hub/schoolInfo?${searchParams.toString()}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as {
    schoolInfo?: Array<{ row?: Array<Record<string, string>> }>;
  };

  const rows = payload.schoolInfo?.[1]?.row ?? [];
  const mapped: SchoolSearchItem[] = [];

  for (const row of rows) {
    const schoolLevel = mapNaisSchoolLevel(row.SCHUL_KND_SC_NM);
    if (!schoolLevel) {
      continue;
    }

    if (schoolLevel === 'middle' && !needsMiddle) {
      continue;
    }
    if (schoolLevel === 'high' && !needsHigh) {
      continue;
    }

    const sidoName = row.LCTN_SC_NM ?? null;
    const sidoCode = resolveSidoCode(sidoName);
    const sigunguResolved = resolveSigunguCode({
      sidoCode,
      address: row.ORG_RDNMA ?? null,
    });

    mapped.push({
      source: 'nais',
      schoolCode: row.SD_SCHUL_CODE,
      schoolName: row.SCHUL_NM,
      schoolLevel,
      campusType: '본교',
      parentSchoolId: null,
      sidoName,
      sidoCode,
      sigunguName: sigunguResolved.sigunguName,
      sigunguCode: sigunguResolved.sigunguCode,
      address: row.ORG_RDNMA ?? null,
      isActive: true,
    });
  }

  return mapped.slice(0, limit);
}

export async function GET(request: Request) {
  try {
    const parsed = searchSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );

    if (!parsed.success) {
      return NextResponse.json(
        { error: '잘못된 검색 파라미터입니다.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { q, level, limit } = parsed.data;
    const [localItems, naisItems] = await Promise.all([
      searchLocalSchools({ q, level, limit }),
      searchNaisSchools({ q, level, limit }),
    ]);

    const deduped = new Map<string, SchoolSearchItem>();
    for (const item of [...localItems, ...naisItems]) {
      deduped.set(`${item.source}:${item.schoolCode}`, item);
    }

    return NextResponse.json({ items: Array.from(deduped.values()).slice(0, limit) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'school search failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
