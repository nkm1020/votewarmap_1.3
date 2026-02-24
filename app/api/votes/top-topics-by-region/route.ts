import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const querySchema = z.object({
  level: z.enum(['sido', 'sigungu']).default('sido'),
  code: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(10).default(3),
});

type VoteRow = {
  topic_id: string | null;
  created_at: string | null;
};

type GuestVoteRow = {
  topic_id: string | null;
  voted_at: string | null;
};

function parseTimeMs(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
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

    const { level, code, limit } = parsed.data;
    const regionCode = String(code).trim();
    const regionColumn = level === 'sigungu' ? 'sigungu_code' : 'sido_code';
    const supabase = getSupabaseServiceRoleClient();

    const { data: voteRows, error: voteError } = await supabase
      .from('votes')
      .select('topic_id, created_at')
      .eq(regionColumn, regionCode);

    if (voteError) {
      return NextResponse.json({ error: voteError.message }, { status: 500 });
    }

    const cutoffIso = new Date(Date.now() - 90 * 1000).toISOString();
    const { data: sessionRows, error: sessionError } = await supabase
      .from('guest_vote_sessions')
      .select('id')
      .gte('last_seen_at', cutoffIso)
      .limit(1000);

    if (sessionError) {
      return NextResponse.json({ error: sessionError.message }, { status: 500 });
    }

    let guestRows: GuestVoteRow[] = [];
    const activeSessionIds = (sessionRows ?? [])
      .map((row) => String(row.id ?? '').trim())
      .filter((id) => id.length > 0);

    if (activeSessionIds.length > 0) {
      const { data: guestVoteRows, error: guestVoteError } = await supabase
        .from('guest_votes_temp')
        .select('topic_id, voted_at')
        .eq(regionColumn, regionCode)
        .in('session_id', activeSessionIds);

      if (guestVoteError) {
        return NextResponse.json({ error: guestVoteError.message }, { status: 500 });
      }

      guestRows = (guestVoteRows ?? []) as GuestVoteRow[];
    }

    const aggregate = new Map<string, { voteCount: number; lastVoteAt: string }>();

    ((voteRows ?? []) as VoteRow[]).forEach((row) => {
      const topicId = String(row.topic_id ?? '').trim();
      if (!topicId) {
        return;
      }
      const current = aggregate.get(topicId) ?? { voteCount: 0, lastVoteAt: '' };
      current.voteCount += 1;
      if (parseTimeMs(row.created_at) > parseTimeMs(current.lastVoteAt)) {
        current.lastVoteAt = row.created_at ?? current.lastVoteAt;
      }
      aggregate.set(topicId, current);
    });

    guestRows.forEach((row) => {
      const topicId = String(row.topic_id ?? '').trim();
      if (!topicId) {
        return;
      }
      const current = aggregate.get(topicId) ?? { voteCount: 0, lastVoteAt: '' };
      current.voteCount += 1;
      if (parseTimeMs(row.voted_at) > parseTimeMs(current.lastVoteAt)) {
        current.lastVoteAt = row.voted_at ?? current.lastVoteAt;
      }
      aggregate.set(topicId, current);
    });

    const topicIds = Array.from(aggregate.keys());
    if (topicIds.length === 0) {
      return NextResponse.json({ level, code: regionCode, topics: [] });
    }

    const { data: topicRows, error: topicError } = await supabase
      .from('vote_topics')
      .select('id, title, status')
      .in('id', topicIds);

    if (topicError) {
      return NextResponse.json({ error: topicError.message }, { status: 500 });
    }

    const topicMeta = new Map(
      (topicRows ?? []).map((row) => [
        String(row.id ?? ''),
        {
          title: String(row.title ?? row.id ?? ''),
          status: String(row.status ?? ''),
        },
      ]),
    );

    const topics = topicIds
      .map((topicId) => {
        const counted = aggregate.get(topicId);
        if (!counted) {
          return null;
        }

        const meta = topicMeta.get(topicId);
        return {
          topicId,
          title: meta?.title ?? topicId,
          status: meta?.status ?? '',
          voteCount: counted.voteCount,
          lastVoteAt: counted.lastVoteAt,
        };
      })
      .filter((topic): topic is NonNullable<typeof topic> => Boolean(topic))
      .sort((a, b) => {
        if (b.voteCount !== a.voteCount) {
          return b.voteCount - a.voteCount;
        }
        const timeDiff = parseTimeMs(b.lastVoteAt) - parseTimeMs(a.lastVoteAt);
        if (timeDiff !== 0) {
          return timeDiff;
        }
        return a.title.localeCompare(b.title, 'ko');
      })
      .slice(0, limit);

    return NextResponse.json({
      level,
      code: regionCode,
      topics,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'top topics by region failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

