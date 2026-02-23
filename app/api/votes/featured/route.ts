import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import type { VoteTopic } from '@/lib/vote/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const querySchema = z.object({
  status: z.string().trim().min(1).default('LIVE'),
});

type VoteTopicRow = {
  id: string;
  title: string;
  status: string;
};

type VoteOptionRow = {
  topic_id: string;
  option_key: string;
  option_label: string;
  position: number;
};

type TopicScoreRow = {
  topic_id: string | null;
  total_votes: number | string | null;
  realtime_votes: number | string | null;
  score: number | string | null;
  last_vote_at: string | null;
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

    const { status } = parsed.data;
    const supabase = getSupabaseServiceRoleClient();
    const { data: scoreboardRows, error: scoreboardError } = await supabase.rpc('get_topic_live_scoreboard', {
      p_status: status,
    });

    if (scoreboardError) {
      return NextResponse.json({ error: scoreboardError.message }, { status: 500 });
    }

    const rankedRows = (Array.isArray(scoreboardRows) ? scoreboardRows : []) as TopicScoreRow[];
    const candidateTopicIds = rankedRows
      .map((row) => String(row.topic_id ?? '').trim())
      .filter(Boolean);

    if (candidateTopicIds.length === 0) {
      return NextResponse.json({ topic: null });
    }

    const { data: topicRows, error: topicsError } = await supabase
      .from('vote_topics')
      .select('id, title, status')
      .in('id', candidateTopicIds);

    if (topicsError) {
      return NextResponse.json({ error: topicsError.message }, { status: 500 });
    }

    const { data: optionRows, error: optionsError } = await supabase
      .from('vote_options')
      .select('topic_id, option_key, option_label, position')
      .in('topic_id', candidateTopicIds)
      .order('position', { ascending: true });

    if (optionsError) {
      return NextResponse.json({ error: optionsError.message }, { status: 500 });
    }

    const topicById = new Map<string, VoteTopicRow>();
    ((topicRows ?? []) as VoteTopicRow[]).forEach((row) => {
      topicById.set(row.id, row);
    });

    const optionsByTopic = new Map<string, VoteTopic['options']>();
    ((optionRows ?? []) as VoteOptionRow[]).forEach((row) => {
      if (row.position !== 1 && row.position !== 2) {
        return;
      }

      const options = optionsByTopic.get(row.topic_id) ?? [];
      options.push({
        key: row.option_key,
        label: row.option_label,
        position: row.position,
      });
      optionsByTopic.set(row.topic_id, options);
    });

    for (const scoreRow of rankedRows) {
      const topicId = String(scoreRow.topic_id ?? '').trim();
      if (!topicId) {
        continue;
      }

      const topicRow = topicById.get(topicId);
      if (!topicRow) {
        continue;
      }

      const topic: VoteTopic = {
        id: topicRow.id,
        title: topicRow.title,
        status: topicRow.status,
        options: optionsByTopic.get(topicId) ?? [],
      };
      if (!hasRequiredOptions(topic)) {
        continue;
      }

      const lastVoteAt =
        scoreRow.last_vote_at && Number.isFinite(Date.parse(scoreRow.last_vote_at))
          ? scoreRow.last_vote_at
          : null;

      return NextResponse.json({
        topic,
        metrics: {
          totalVotes: normalizeInt(scoreRow.total_votes),
          realtimeVotes: normalizeInt(scoreRow.realtime_votes),
          score: normalizeInt(scoreRow.score),
          lastVoteAt,
        },
      });
    }

    return NextResponse.json({ topic: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'featured topic fetch failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
