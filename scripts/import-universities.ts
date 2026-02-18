import path from 'node:path';
import xlsx from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { resolveSidoCode, resolveSigunguCode } from '../lib/server/regions';

type XlsRow = Record<string, unknown>;

type LocalSchoolRecord = {
  source: 'local_xls';
  school_code: string;
  school_name: string;
  school_level: 'university' | 'graduate';
  campus_type: string | null;
  parent_school_id: null;
  sido_name: string | null;
  sido_code: string | null;
  sigungu_name: string | null;
  sigungu_code: string | null;
  address: string | null;
  is_active: boolean;
};

function normalizeBaseName(name: string): string {
  return name.replace(/\(.*?\)/g, '').replace(/\s+/g, '').trim();
}

function formatSchoolCode(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }

  if (/^\d+$/.test(raw) && raw.length < 7) {
    return raw.padStart(7, '0');
  }

  return raw;
}

function toSchoolLevel(gradeText: unknown): 'university' | 'graduate' {
  const value = String(gradeText ?? '').trim();
  return value.includes('대학원') ? 'graduate' : 'university';
}

function toCampusType(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function toIsActive(status: unknown): boolean {
  return String(status ?? '').trim() !== '폐교';
}

function toAddress(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function toSidoName(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function parseRows(filePath: string): LocalSchoolRecord[] {
  const workbook = xlsx.readFile(filePath);
  const firstSheet = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheet];
  const rows = xlsx.utils.sheet_to_json<XlsRow>(sheet, { defval: '' });

  return rows
    .filter((row) => String(row['학교구분'] ?? '').trim() === '대학')
    .map((row) => {
      const schoolCode = formatSchoolCode(row['학교코드']);
      const schoolName = String(row['학교명'] ?? '').trim();
      const campusType = toCampusType(row['본분교']);
      const schoolLevel = toSchoolLevel(row['학제']);
      const sidoName = toSidoName(row['지역']);
      const address = toAddress(row['주소']);
      const sidoCode = resolveSidoCode(sidoName);
      const sigunguResolved = resolveSigunguCode({
        sidoCode,
        address,
      });

      const record: LocalSchoolRecord = {
        source: 'local_xls',
        school_code: schoolCode,
        school_name: schoolName,
        school_level: schoolLevel,
        campus_type: campusType,
        parent_school_id: null,
        sido_name: sidoName,
        sido_code: sidoCode,
        sigungu_name: sigunguResolved.sigunguName,
        sigungu_code: sigunguResolved.sigunguCode,
        address,
        is_active: toIsActive(row['학교상태']),
      };

      return record;
    })
    .filter((item) => item.school_code && item.school_name);
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.');
  }

  const inputPath =
    process.argv[2] ??
    '/Users/kangmin/Documents/Project/학교개황(20241007 기준).xls';

  const resolvedPath = path.resolve(inputPath);
  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const records = parseRows(resolvedPath);
  if (records.length === 0) {
    throw new Error('가져올 대학 데이터가 없습니다.');
  }

  for (let i = 0; i < records.length; i += 200) {
    const batch = records.slice(i, i + 200);
    const { error } = await supabase.from('schools').upsert(batch, {
      onConflict: 'source,school_code',
    });
    if (error) {
      throw new Error(`upsert failed: ${error.message}`);
    }
  }

  const { data: insertedSchools, error: fetchError } = await supabase
    .from('schools')
    .select('id, school_name, campus_type, school_code')
    .eq('source', 'local_xls');

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  const rows = insertedSchools ?? [];
  const parentsByName = new Map<string, string>();

  rows.forEach((row) => {
    const baseName = normalizeBaseName(row.school_name);
    if (!parentsByName.has(baseName) && String(row.campus_type ?? '').includes('본교')) {
      parentsByName.set(baseName, row.id);
    }
  });

  rows.forEach((row) => {
    const baseName = normalizeBaseName(row.school_name);
    if (!parentsByName.has(baseName)) {
      parentsByName.set(baseName, row.id);
    }
  });

  let updatedParentLinks = 0;
  for (const row of rows) {
    const campusType = String(row.campus_type ?? '');
    if (campusType.includes('본교')) {
      continue;
    }

    const parentId = parentsByName.get(normalizeBaseName(row.school_name));
    if (!parentId || parentId === row.id) {
      continue;
    }

    const { error } = await supabase
      .from('schools')
      .update({ parent_school_id: parentId })
      .eq('id', row.id);

    if (error) {
      throw new Error(`parent link update failed: ${error.message}`);
    }

    updatedParentLinks += 1;
  }

  console.log(
    `[import-universities] imported=${records.length} parent_links_updated=${updatedParentLinks} file=${resolvedPath}`,
  );
}

main().catch((error) => {
  console.error('[import-universities] failed:', error);
  process.exit(1);
});
