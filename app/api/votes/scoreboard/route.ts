import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const querySchema = z.object({
  status: z.string().trim().min(1).default('LIVE'),
  minTotalVotes: z.coerce.number().int().min(1).default(1),
});

type TopicScoreRow = {
  topic_id: string | null;
  total_votes: number | string | null;
  realtime_votes: number | string | null;
  score: number | string | null;
  last_vote_at: string | null;
};

type VoteTopicRow = {
  id: string;
  title: string;
  status: string;
};

type ScoreboardItem = {
  topicId: string;
  title: string;
  status: string;
  totalVotes: number;
  realtimeVotes: number;
  score: number;
  lastVoteAt: string | null;
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

function normalizeTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function parseTimeMs(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

    const { status, minTotalVotes } = parsed.data;
    const supabase = getSupabaseServiceRoleClient();

    const { data: scoreboardRows, error: scoreboardError } = await supabase.rpc('get_topic_live_scoreboard', {
      p_status: status,
    });
    if (scoreboardError) {
      return NextResponse.json({ error: scoreboardError.message }, { status: 500 });
    }

    const rankedRows = (Array.isArray(scoreboardRows) ? scoreboardRows : []) as TopicScoreRow[];
    const topicIds = rankedRows
      .map((row) => String(row.topic_id ?? '').trim())
      .filter(Boolean);

    if (topicIds.length === 0) {
      return NextResponse.json({ items: [] as ScoreboardItem[] });
    }

    const { data: topicRows, error: topicsError } = await supabase
      .from('vote_topics')
      .select('id, title, status')
      .in('id', topicIds);
    if (topicsError) {
      return NextResponse.json({ error: topicsError.message }, { status: 500 });
    }

    const topicById = new Map<string, VoteTopicRow>();
    ((topicRows ?? []) as VoteTopicRow[]).forEach((row) => {
      topicById.set(row.id, row);
    });

    const items: ScoreboardItem[] = rankedRows
      .map((row) => {
        const topicId = String(row.topic_id ?? '').trim();
        if (!topicId) {
          return null;
        }

        const topic = topicById.get(topicId);
        if (!topic) {
          return null;
        }

        return {
          topicId,
          title: topic.title,
          status: topic.status,
          totalVotes: normalizeInt(row.total_votes),
          realtimeVotes: normalizeInt(row.realtime_votes),
          score: normalizeInt(row.score),
          lastVoteAt: normalizeTimestamp(row.last_vote_at),
        } satisfies ScoreboardItem;
      })
      .filter((item): item is ScoreboardItem => Boolean(item))
      .filter((item) => item.totalVotes >= minTotalVotes)
      .sort((a, b) => {
        if (b.totalVotes !== a.totalVotes) {
          return b.totalVotes - a.totalVotes;
        }
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        const lastVoteDiff = parseTimeMs(b.lastVoteAt) - parseTimeMs(a.lastVoteAt);
        if (lastVoteDiff !== 0) {
          return lastVoteDiff;
        }
        return a.topicId.localeCompare(b.topicId, 'ko');
      });

    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'scoreboard fetch failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
