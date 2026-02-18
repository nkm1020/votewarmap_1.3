import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import type { VoteTopic } from '@/lib/vote/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const querySchema = z.object({
  status: z.string().trim().min(1).default('LIVE'),
  ids: z.string().optional(),
});

type VoteTopicRow = {
  id: string;
  title: string;
  status: string;
  created_at: string;
};

type VoteOptionRow = {
  topic_id: string;
  option_key: string;
  option_label: string;
  position: number;
};

function parseIds(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  const unique = new Set<string>();
  raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => unique.add(value));

  return Array.from(unique);
}

function hasRequiredOptions(topic: VoteTopic): boolean {
  const hasA = topic.options.some((option) => option.position === 1);
  const hasB = topic.options.some((option) => option.position === 2);
  return hasA && hasB;
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

    const { status, ids: idsRaw } = parsed.data;
    const requestedIds = parseIds(idsRaw);
    const supabase = getSupabaseServiceRoleClient();

    let topicsQuery = supabase
      .from('vote_topics')
      .select('id, title, status, created_at')
      .order('created_at', { ascending: false });

    if (status.toUpperCase() !== 'ALL') {
      topicsQuery = topicsQuery.eq('status', status);
    }

    if (requestedIds.length > 0) {
      topicsQuery = topicsQuery.in('id', requestedIds);
    }

    const { data: topicRows, error: topicsError } = await topicsQuery;
    if (topicsError) {
      return NextResponse.json({ error: topicsError.message }, { status: 500 });
    }

    const topics = (topicRows ?? []) as VoteTopicRow[];
    if (topics.length === 0) {
      return NextResponse.json({ topics: [] as VoteTopic[] });
    }

    const topicIds = topics.map((topic) => topic.id);
    const { data: optionRows, error: optionsError } = await supabase
      .from('vote_options')
      .select('topic_id, option_key, option_label, position')
      .in('topic_id', topicIds)
      .order('position', { ascending: true });

    if (optionsError) {
      return NextResponse.json({ error: optionsError.message }, { status: 500 });
    }

    const optionsByTopic = new Map<string, VoteTopic['options']>();
    ((optionRows ?? []) as VoteOptionRow[]).forEach((row) => {
      if (row.position !== 1 && row.position !== 2) {
        return;
      }

      const list = optionsByTopic.get(row.topic_id) ?? [];
      list.push({
        key: row.option_key,
        label: row.option_label,
        position: row.position,
      });
      optionsByTopic.set(row.topic_id, list);
    });

    const mergedTopics = topics
      .map<VoteTopic>((topic) => ({
        id: topic.id,
        title: topic.title,
        status: topic.status,
        options: optionsByTopic.get(topic.id) ?? [],
      }))
      .filter(hasRequiredOptions);

    if (requestedIds.length === 0) {
      return NextResponse.json({ topics: mergedTopics });
    }

    const byId = new Map(mergedTopics.map((topic) => [topic.id, topic]));
    const ordered = requestedIds
      .map((id) => byId.get(id))
      .filter((topic): topic is VoteTopic => Boolean(topic));

    return NextResponse.json({ topics: ordered });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'topics fetch failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
