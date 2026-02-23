import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { geocodeSchool } from '../lib/server/geocode';

type AggregateSchoolIdRow = {
  aggregate_school_id: string | null;
};

type GuestSessionRow = {
  id: string;
};

type SchoolRow = {
  id: string;
  school_name: string;
  address: string | null;
  sido_name: string | null;
  sigungu_name: string | null;
  latitude: number | null;
  longitude: number | null;
  geocode_status: string | null;
};

const PAGE_SIZE = 1000;
const SESSION_CHUNK_SIZE = 120;
const SCHOOL_CHUNK_SIZE = 250;
const ACTIVE_GUEST_TTL_MS = 90 * 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function hasCoordinates(row: SchoolRow): boolean {
  return Number.isFinite(row.latitude) && Number.isFinite(row.longitude);
}

async function fetchVoteAggregateSchoolIds(supabase: SupabaseClient): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('votes')
      .select('aggregate_school_id')
      .not('aggregate_school_id', 'is', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message);
    }

    const rows = (data ?? []) as AggregateSchoolIdRow[];
    rows.forEach((row) => {
      if (row.aggregate_school_id) {
        ids.add(row.aggregate_school_id);
      }
    });

    if (rows.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return ids;
}

async function fetchActiveGuestSessionIds(supabase: SupabaseClient): Promise<string[]> {
  const sessionIds: string[] = [];
  let offset = 0;
  const activeCutoffIso = new Date(Date.now() - ACTIVE_GUEST_TTL_MS).toISOString();

  while (true) {
    const { data, error } = await supabase
      .from('guest_vote_sessions')
      .select('id')
      .gte('last_seen_at', activeCutoffIso)
      .order('last_seen_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message);
    }

    const rows = (data ?? []) as GuestSessionRow[];
    rows.forEach((row) => sessionIds.push(row.id));

    if (rows.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return sessionIds;
}

async function fetchGuestAggregateSchoolIds(
  supabase: SupabaseClient,
  sessionIds: string[],
): Promise<Set<string>> {
  const ids = new Set<string>();

  for (const sessionChunk of chunk(sessionIds, SESSION_CHUNK_SIZE)) {
    let offset = 0;

    while (true) {
      const { data, error } = await supabase
        .from('guest_votes_temp')
        .select('aggregate_school_id')
        .in('session_id', sessionChunk)
        .not('aggregate_school_id', 'is', null)
        .order('voted_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        throw new Error(error.message);
      }

      const rows = (data ?? []) as AggregateSchoolIdRow[];
      rows.forEach((row) => {
        if (row.aggregate_school_id) {
          ids.add(row.aggregate_school_id);
        }
      });

      if (rows.length < PAGE_SIZE) {
        break;
      }

      offset += PAGE_SIZE;
    }
  }

  return ids;
}

async function fetchSchoolsByIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<SchoolRow[]> {
  const schools: SchoolRow[] = [];

  for (const schoolChunk of chunk(ids, SCHOOL_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('schools')
      .select('id, school_name, address, sido_name, sigungu_name, latitude, longitude, geocode_status')
      .in('id', schoolChunk);

    if (error) {
      throw new Error(error.message);
    }

    schools.push(...((data ?? []) as SchoolRow[]));
  }

  return schools;
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

  const voteSchoolIds = await fetchVoteAggregateSchoolIds(supabase);
  const activeSessionIds = await fetchActiveGuestSessionIds(supabase);
  const guestSchoolIds =
    activeSessionIds.length > 0
      ? await fetchGuestAggregateSchoolIds(supabase, activeSessionIds)
      : new Set<string>();

  const targetIds = new Set<string>([...voteSchoolIds, ...guestSchoolIds]);
  if (targetIds.size === 0) {
    console.log('[backfill-school-coordinates] no target schools found');
    return;
  }

  const schools = await fetchSchoolsByIds(supabase, Array.from(targetIds));
  const unresolvedSchools = schools.filter((school) => !hasCoordinates(school));

  if (unresolvedSchools.length === 0) {
    console.log(
      `[backfill-school-coordinates] targets=${targetIds.size} already_geocoded=${schools.length}`,
    );
    return;
  }

  const perRequestDelayMs = Number(process.env.GEOCODE_DELAY_MS ?? 260);
  const runLimit = Number(process.env.SCHOOL_COORDINATE_BACKFILL_LIMIT ?? 0);
  const worklist = runLimit > 0 ? unresolvedSchools.slice(0, runLimit) : unresolvedSchools;

  let successCount = 0;
  let failedCount = 0;

  for (const school of worklist) {
    const result = await geocodeSchool({
      schoolName: school.school_name,
      address: school.address,
      sidoName: school.sido_name,
      sigunguName: school.sigungu_name,
    });

    const attemptedAt = new Date().toISOString();

    if (result) {
      const { error } = await supabase
        .from('schools')
        .update({
          latitude: result.latitude,
          longitude: result.longitude,
          geocode_provider: result.provider,
          geocoded_at: attemptedAt,
          geocode_status: 'ok',
          geocode_attempted_at: attemptedAt,
        })
        .eq('id', school.id);

      if (error) {
        throw new Error(error.message);
      }

      successCount += 1;
    } else {
      const { error } = await supabase
        .from('schools')
        .update({
          geocode_status: 'failed',
          geocode_attempted_at: attemptedAt,
        })
        .eq('id', school.id);

      if (error) {
        throw new Error(error.message);
      }

      failedCount += 1;
    }

    if (perRequestDelayMs > 0) {
      await delay(perRequestDelayMs);
    }
  }

  console.log(
    `[backfill-school-coordinates] voteTargets=${voteSchoolIds.size} activeGuestTargets=${guestSchoolIds.size} ` +
      `worklist=${worklist.length} geocoded=${successCount} failed=${failedCount}`,
  );
}

main().catch((error) => {
  console.error('[backfill-school-coordinates] failed:', error);
  process.exit(1);
});
