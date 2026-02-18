import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type VoteRow = {
  id: string;
  sido_code: string | null;
  sigungu_code: string | null;
  school:
    | {
        sido_code: string | null;
        sigungu_code: string | null;
      }
    | Array<{
        sido_code: string | null;
        sigungu_code: string | null;
      }>
    | null;
};

async function fetchVotesWithSchool(
  supabase: SupabaseClient,
): Promise<VoteRow[]> {
  const pageSize = 1000;
  const rows: VoteRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('votes')
      .select('id, sido_code, sigungu_code, school:schools!votes_school_id_fkey(sido_code, sigungu_code)')
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(error.message);
    }

    const batch = (data ?? []) as VoteRow[];
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

  const votes = await fetchVotesWithSchool(supabase);
  let updated = 0;
  let unresolved = 0;

  for (const vote of votes) {
    const school = Array.isArray(vote.school) ? vote.school[0] : vote.school;
    const nextSidoCode = school?.sido_code ?? vote.sido_code;
    const nextSigunguCode = school?.sigungu_code ?? vote.sigungu_code;

    if (!nextSidoCode || !nextSigunguCode) {
      unresolved += 1;
      continue;
    }

    if (vote.sido_code === nextSidoCode && vote.sigungu_code === nextSigunguCode) {
      continue;
    }

    const { error } = await supabase
      .from('votes')
      .update({
        sido_code: nextSidoCode,
        sigungu_code: nextSigunguCode,
      })
      .eq('id', vote.id);

    if (error) {
      throw new Error(error.message);
    }

    updated += 1;
  }

  console.log(
    `[backfill-vote-regions] scanned=${votes.length} updated=${updated} unresolved=${unresolved}`,
  );
}

main().catch((error) => {
  console.error('[backfill-vote-regions] failed:', error);
  process.exit(1);
});
