import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveSidoCode, resolveSigunguCode } from '../lib/server/regions';

type SchoolRow = {
  id: string;
  source: 'nais' | 'local_xls';
  school_code: string;
  school_name: string;
  sido_name: string | null;
  sido_code: string | null;
  sigungu_name: string | null;
  sigungu_code: string | null;
  address: string | null;
};

async function fetchAllSchoolsWithMissingRegion(
  supabase: SupabaseClient,
): Promise<SchoolRow[]> {
  const pageSize = 1000;
  const rows: SchoolRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('schools')
      .select('id, source, school_code, school_name, sido_name, sido_code, sigungu_name, sigungu_code, address')
      .or('sido_code.is.null,sigungu_code.is.null')
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(error.message);
    }

    const batch = (data ?? []) as SchoolRow[];
    rows.push(...batch);
    if (batch.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return rows;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.');
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const schools = await fetchAllSchoolsWithMissingRegion(supabase);
  if (schools.length === 0) {
    console.log('[backfill-school-regions] nothing to update');
    return;
  }

  let updated = 0;
  for (const school of schools) {
    const nextSidoCode = school.sido_code ?? resolveSidoCode(school.sido_name);
    const resolvedSigungu = resolveSigunguCode({
      sidoCode: nextSidoCode,
      sigunguName: school.sigungu_name,
      address: school.address,
    });
    const nextSigunguCode = school.sigungu_code ?? resolvedSigungu.sigunguCode;
    const nextSigunguName = school.sigungu_name ?? resolvedSigungu.sigunguName;

    if (
      (school.sido_code ?? null) === (nextSidoCode ?? null) &&
      (school.sigungu_code ?? null) === (nextSigunguCode ?? null) &&
      (school.sigungu_name ?? null) === (nextSigunguName ?? null)
    ) {
      continue;
    }

    const { error } = await supabase
      .from('schools')
      .update({
        sido_code: nextSidoCode,
        sigungu_code: nextSigunguCode,
        sigungu_name: nextSigunguName,
      })
      .eq('id', school.id);
    if (error) {
      throw new Error(error.message);
    }

    updated += 1;
  }

  console.log(`[backfill-school-regions] scanned=${schools.length} updated=${updated}`);
}

main().catch((error) => {
  console.error('[backfill-school-regions] failed:', error);
  process.exit(1);
});
