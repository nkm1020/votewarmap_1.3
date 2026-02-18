import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { resolveSidoCode, resolveSigunguCode } from '@/lib/server/regions';
import type { SchoolSearchItem } from '@/lib/vote/types';

type SchoolRow = {
  id: string;
  source: 'nais' | 'local_xls';
  school_code: string;
  school_name: string;
  school_level: string;
  campus_type: string | null;
  parent_school_id: string | null;
  sido_name: string | null;
  sido_code: string | null;
  sigungu_name: string | null;
  sigungu_code: string | null;
  address: string | null;
  is_active: boolean;
};

export type EnsuredSchool = {
  schoolId: string;
  aggregateSchoolId: string;
  schoolRow: SchoolRow;
};

export type SchoolIdentity = {
  schoolId: string;
  aggregateSchoolId: string;
  sidoCode: string | null;
  sigunguCode: string | null;
};

export async function ensureSchool(item: SchoolSearchItem): Promise<EnsuredSchool> {
  const supabase = getSupabaseServiceRoleClient();

  const { data: existing, error: existingError } = await supabase
    .from('schools')
    .select(
      'id, source, school_code, school_name, school_level, campus_type, parent_school_id, sido_name, sido_code, sigungu_name, sigungu_code, address, is_active',
    )
    .eq('source', item.source)
    .eq('school_code', item.schoolCode)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existing) {
    const nextSidoCode = existing.sido_code ?? item.sidoCode ?? resolveSidoCode(item.sidoName ?? existing.sido_name);
    const resolvedSigungu = resolveSigunguCode({
      sidoCode: nextSidoCode,
      sigunguName: existing.sigungu_name ?? item.sigunguName,
      address: existing.address ?? item.address,
    });

    const nextSigunguCode = existing.sigungu_code ?? item.sigunguCode ?? resolvedSigungu.sigunguCode;
    const nextSigunguName = existing.sigungu_name ?? item.sigunguName ?? resolvedSigungu.sigunguName;
    const needsRegionBackfill =
      (existing.sido_code ?? null) !== (nextSidoCode ?? null) ||
      (existing.sigungu_code ?? null) !== (nextSigunguCode ?? null) ||
      (existing.sigungu_name ?? null) !== (nextSigunguName ?? null);

    if (needsRegionBackfill) {
      const { data: updated, error: updateError } = await supabase
        .from('schools')
        .update({
          sido_code: nextSidoCode,
          sigungu_code: nextSigunguCode,
          sigungu_name: nextSigunguName,
        })
        .eq('id', existing.id)
        .select(
          'id, source, school_code, school_name, school_level, campus_type, parent_school_id, sido_name, sido_code, sigungu_name, sigungu_code, address, is_active',
        )
        .single();

      if (updateError) {
        throw new Error(updateError.message);
      }

      return {
        schoolId: updated.id,
        aggregateSchoolId: updated.parent_school_id ?? updated.id,
        schoolRow: updated as SchoolRow,
      };
    }

    return {
      schoolId: existing.id,
      aggregateSchoolId: existing.parent_school_id ?? existing.id,
      schoolRow: existing as SchoolRow,
    };
  }

  const sidoCode = item.sidoCode ?? resolveSidoCode(item.sidoName);
  const sigunguResolved = resolveSigunguCode({
    sidoCode,
    sigunguName: item.sigunguName,
    address: item.address,
  });

  const { data: inserted, error: insertError } = await supabase
    .from('schools')
    .insert({
      source: item.source,
      school_code: item.schoolCode,
      school_name: item.schoolName,
      school_level: item.schoolLevel,
      campus_type: item.campusType,
      parent_school_id: item.parentSchoolId,
      sido_name: item.sidoName,
      sido_code: sidoCode,
      sigungu_name: item.sigunguName ?? sigunguResolved.sigunguName,
      sigungu_code: item.sigunguCode ?? sigunguResolved.sigunguCode,
      address: item.address,
      is_active: item.isActive,
    })
    .select(
      'id, source, school_code, school_name, school_level, campus_type, parent_school_id, sido_name, sido_code, sigungu_name, sigungu_code, address, is_active',
    )
    .single();

  if (insertError || !inserted) {
    throw new Error(insertError?.message ?? 'school insert failed');
  }

  return {
    schoolId: inserted.id,
    aggregateSchoolId: inserted.parent_school_id ?? inserted.id,
    schoolRow: inserted as SchoolRow,
  };
}

export async function getSchoolIdentityById(schoolId: string): Promise<SchoolIdentity | null> {
  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('schools')
    .select('id, parent_school_id, sido_code, sigungu_code')
    .eq('id', schoolId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return {
    schoolId: data.id,
    aggregateSchoolId: data.parent_school_id ?? data.id,
    sidoCode: data.sido_code ?? null,
    sigunguCode: data.sigungu_code ?? null,
  };
}
