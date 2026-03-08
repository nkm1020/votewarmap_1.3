import { randomUUID } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type VoteTopicRow = {
  id: string;
  title: string;
  status: string;
};

type VoteOptionRow = {
  topic_id: string;
  option_key: string;
  position: number;
};

type SchoolRow = {
  id: string;
  parent_school_id: string | null;
  sido_code: string | null;
  sigungu_code: string | null;
};

type VoteInsertRow = {
  topic_id: string;
  option_key: string;
  country_code: string;
  user_id: null;
  guest_token: string;
  school_id: string | null;
  aggregate_school_id: string | null;
  birth_year: null;
  gender: null;
  sido_code: string | null;
  sigungu_code: string | null;
  merged_from_guest: boolean;
  created_at: string;
};

type TopicReport = {
  topicId: string;
  topicTitle: string;
  inserted: number;
  countA: number;
  countB: number;
  ratioA: number;
  ratioB: number;
  baseP: number;
  dominant: 'A' | 'B';
  topSido: Array<{ code: string; count: number }>;
};

function mustGetEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parsePositiveInt(
  name: string,
  defaultValue: number,
  minValue: number,
): number {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    return defaultValue;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < minValue) {
    throw new Error(`${name} must be an integer >= ${minValue}`);
  }
  return parsed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function chooseRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

async function loadTopics(
  supabase: SupabaseClient,
  mode: 'live' | 'all',
): Promise<VoteTopicRow[]> {
  let query = supabase.from('vote_topics').select('id, title, status');
  if (mode === 'live') {
    query = query.eq('status', 'LIVE');
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) {
    throw new Error(`load topics failed: ${error.message}`);
  }

  return (data ?? []) as VoteTopicRow[];
}

async function loadOptions(
  supabase: SupabaseClient,
  topicIds: string[],
): Promise<Map<string, { optionAKey: string; optionBKey: string }>> {
  if (topicIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('vote_options')
    .select('topic_id, option_key, position')
    .in('topic_id', topicIds)
    .order('position', { ascending: true });

  if (error) {
    throw new Error(`load options failed: ${error.message}`);
  }

  const grouped = new Map<string, VoteOptionRow[]>();
  ((data ?? []) as VoteOptionRow[]).forEach((row) => {
    const list = grouped.get(row.topic_id) ?? [];
    list.push(row);
    grouped.set(row.topic_id, list);
  });

  const resolved = new Map<string, { optionAKey: string; optionBKey: string }>();
  grouped.forEach((rows, topicId) => {
    const optionA = rows.find((row) => row.position === 1);
    const optionB = rows.find((row) => row.position === 2);
    if (optionA && optionB) {
      resolved.set(topicId, {
        optionAKey: optionA.option_key,
        optionBKey: optionB.option_key,
      });
    }
  });

  return resolved;
}

async function loadSchools(supabase: SupabaseClient): Promise<SchoolRow[]> {
  const { data, error } = await supabase
    .from('schools')
    .select('id, parent_school_id, sido_code, sigungu_code')
    .not('sido_code', 'is', null)
    .not('sigungu_code', 'is', null);

  if (error) {
    throw new Error(`load schools failed: ${error.message}`);
  }

  return ((data ?? []) as SchoolRow[]).filter(
    (row) =>
      typeof row.id === 'string' &&
      typeof row.sido_code === 'string' &&
      row.sido_code.trim().length > 0 &&
      typeof row.sigungu_code === 'string' &&
      row.sigungu_code.trim().length > 0,
  );
}

function buildSidoOffsets(sidoCodes: string[]): Map<string, number> {
  const offsetBySido = new Map<string, number>();
  sidoCodes.forEach((code) => {
    offsetBySido.set(code, randomInRange(-0.08, 0.08));
  });
  return offsetBySido;
}

function makeGuestToken(runId: string, topicId: string, seq: number): string {
  return `dummy_${runId}_${topicId}_${String(seq).padStart(4, '0')}_${randomUUID().slice(0, 8)}`;
}

function buildCreatedAtWithin30Days(): string {
  const nowMs = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const offsetMs = Math.floor(Math.random() * thirtyDaysMs);
  return new Date(nowMs - offsetMs).toISOString();
}

async function insertInBatches(
  supabase: SupabaseClient,
  rows: VoteInsertRow[],
  batchSize: number,
): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from('votes').insert(batch);
    if (error) {
      throw new Error(`insert batch failed at ${i}..${i + batch.length - 1}: ${error.message}`);
    }
  }
}

async function rollbackRun(
  supabase: SupabaseClient,
  runId: string,
): Promise<void> {
  const pattern = `dummy_${runId}_%`;
  const { error } = await supabase.from('votes').delete().ilike('guest_token', pattern);
  if (error) {
    throw new Error(`rollback failed: ${error.message}`);
  }
}

async function main() {
  const supabaseUrl = mustGetEnv('NEXT_PUBLIC_SUPABASE_URL');
  const supabaseKey = mustGetEnv('SUPABASE_SERVICE_ROLE_KEY');
  const runId = mustGetEnv('DUMMY_RUN_ID');
  const votesPerTopic = parsePositiveInt('DUMMY_VOTES_PER_TOPIC', 3000, 1);
  const batchSize = parsePositiveInt('DUMMY_BATCH_SIZE', 500, 1);
  const modeRaw = (process.env.DUMMY_MODE ?? 'live').trim().toLowerCase();
  if (modeRaw !== 'live' && modeRaw !== 'all') {
    throw new Error(`DUMMY_MODE must be one of: live, all`);
  }
  const mode = modeRaw as 'live' | 'all';

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  console.log(
    `[seed-dummy-votes] runId=${runId} mode=${mode} votesPerTopic=${votesPerTopic} batchSize=${batchSize}`,
  );

  const topics = await loadTopics(supabase, mode);
  if (topics.length === 0) {
    throw new Error(`no topics found for mode=${mode}`);
  }

  const optionByTopic = await loadOptions(
    supabase,
    topics.map((topic) => topic.id),
  );

  const invalidTopics = topics.filter((topic) => !optionByTopic.has(topic.id));
  if (invalidTopics.length > 0) {
    const bad = invalidTopics.map((topic) => topic.id).join(', ');
    throw new Error(`topics missing required options(position 1&2): ${bad}`);
  }

  const schools = await loadSchools(supabase);
  if (schools.length === 0) {
    throw new Error(`no schools with valid sido/sigungu found`);
  }
  const sidoCodes = Array.from(new Set(schools.map((school) => school.sido_code as string)));

  const topicReports: TopicReport[] = [];
  let totalInserted = 0;

  try {
    for (const topic of topics) {
      const option = optionByTopic.get(topic.id);
      if (!option) {
        throw new Error(`topic options missing unexpectedly: ${topic.id}`);
      }

      const baseP = randomInRange(0.55, 0.70);
      const dominant: 'A' | 'B' = Math.random() < 0.5 ? 'A' : 'B';
      const offsetBySido = buildSidoOffsets(sidoCodes);

      const rows: VoteInsertRow[] = [];
      const bySidoCount = new Map<string, number>();
      let countA = 0;
      let countB = 0;

      for (let seq = 1; seq <= votesPerTopic; seq += 1) {
        const school = chooseRandom(schools);
        const sidoCode = school.sido_code as string;
        const sigunguCode = school.sigungu_code as string;
        const offset = offsetBySido.get(sidoCode) ?? 0;
        const rawPA = clamp(baseP + offset, 0.35, 0.65);
        const pA = dominant === 'A' ? rawPA : 1 - rawPA;
        const isA = Math.random() < pA;

        const optionKey = isA ? option.optionAKey : option.optionBKey;
        if (isA) {
          countA += 1;
        } else {
          countB += 1;
        }
        bySidoCount.set(sidoCode, (bySidoCount.get(sidoCode) ?? 0) + 1);

        rows.push({
          topic_id: topic.id,
          option_key: optionKey,
          country_code: 'KR',
          user_id: null,
          guest_token: makeGuestToken(runId, topic.id, seq),
          school_id: school.id,
          aggregate_school_id: school.parent_school_id ?? school.id,
          birth_year: null,
          gender: null,
          sido_code: sidoCode,
          sigungu_code: sigunguCode,
          merged_from_guest: false,
          created_at: buildCreatedAtWithin30Days(),
        });
      }

      await insertInBatches(supabase, rows, batchSize);
      totalInserted += rows.length;

      const topSido = Array.from(bySidoCount.entries())
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      topicReports.push({
        topicId: topic.id,
        topicTitle: topic.title,
        inserted: rows.length,
        countA,
        countB,
        ratioA: rows.length > 0 ? countA / rows.length : 0,
        ratioB: rows.length > 0 ? countB / rows.length : 0,
        baseP,
        dominant,
        topSido,
      });
    }
  } catch (error) {
    console.error('[seed-dummy-votes] failed during insert. rollback started.');
    await rollbackRun(supabase, runId);
    throw error;
  }

  topicReports.forEach((report) => {
    console.log(
      [
        `[seed-dummy-votes][topic] id=${report.topicId}`,
        `title="${report.topicTitle}"`,
        `inserted=${report.inserted}`,
        `A=${report.countA}(${(report.ratioA * 100).toFixed(2)}%)`,
        `B=${report.countB}(${(report.ratioB * 100).toFixed(2)}%)`,
        `baseP=${report.baseP.toFixed(4)}`,
        `dominant=${report.dominant}`,
      ].join(' '),
    );
    console.log(
      `[seed-dummy-votes][topic] topSido=${report.topSido
        .map((entry) => `${entry.code}:${entry.count}`)
        .join(', ')}`,
    );
  });

  console.log(
    `[seed-dummy-votes] completed runId=${runId} topics=${topics.length} inserted=${totalInserted} failureBatches=0`,
  );
}

main().catch((error) => {
  console.error('[seed-dummy-votes] failed:', error);
  process.exit(1);
});
