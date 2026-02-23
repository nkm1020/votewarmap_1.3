import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { ensureSchool, getSchoolIdentityById } from '@/lib/server/schools';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const profileSchema = z.object({
  birthYear: z.number().int().min(1900).max(2100),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']),
  school: z.object({
    id: z.string().uuid().optional(),
    source: z.enum(['nais', 'local_xls']),
    schoolCode: z.string().min(1),
    schoolName: z.string().min(1),
    schoolLevel: z.enum(['middle', 'high', 'university', 'graduate']),
    campusType: z.string().nullable(),
    parentSchoolId: z.string().uuid().nullable(),
    sidoName: z.string().nullable(),
    sidoCode: z.string().nullable(),
    sigunguName: z.string().nullable(),
    sigunguCode: z.string().nullable(),
    address: z.string().nullable(),
    isActive: z.boolean(),
  }),
});

const voteBodySchema = z.object({
  topicId: z.string().min(1),
  optionKey: z.string().min(1),
  guestSessionId: z.string().uuid().optional(),
  profile: profileSchema.optional(),
});

export async function POST(request: Request) {
  try {
    const rawBody = (await request.json()) as unknown;
    const parsed = voteBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '잘못된 요청 형식입니다.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const body = parsed.data;
    const user = await resolveUserFromAuthorizationHeader(request.headers.get('authorization'));
    const voterUserId = user?.id ?? null;
    const guestSessionId = voterUserId ? null : body.guestSessionId ?? null;

    if (!voterUserId && !guestSessionId) {
      return NextResponse.json({ error: '비로그인 투표에는 guestSessionId가 필요합니다.' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRoleClient();

    const { data: option, error: optionError } = await supabase
      .from('vote_options')
      .select('option_key')
      .eq('topic_id', body.topicId)
      .eq('option_key', body.optionKey)
      .maybeSingle();

    if (optionError) {
      return NextResponse.json({ error: optionError.message }, { status: 500 });
    }
    if (!option) {
      return NextResponse.json({ error: '유효하지 않은 투표 선택지입니다.' }, { status: 400 });
    }

    if (voterUserId) {
      const { data: existingUserVote, error: existingUserVoteError } = await supabase
        .from('votes')
        .select('id')
        .eq('topic_id', body.topicId)
        .eq('user_id', voterUserId)
        .maybeSingle();

      if (existingUserVoteError) {
        return NextResponse.json({ error: existingUserVoteError.message }, { status: 500 });
      }
      if (existingUserVote) {
        return NextResponse.json({ error: '이미 해당 주제에 투표했습니다.' }, { status: 409 });
      }
    } else if (guestSessionId) {
      const { data: existingGuestVote, error: existingGuestVoteError } = await supabase
        .from('guest_votes_temp')
        .select('id')
        .eq('topic_id', body.topicId)
        .eq('session_id', guestSessionId)
        .maybeSingle();

      if (existingGuestVoteError) {
        return NextResponse.json({ error: existingGuestVoteError.message }, { status: 500 });
      }
      if (existingGuestVote) {
        return NextResponse.json({ error: '이미 해당 주제에 투표했습니다.' }, { status: 409 });
      }
    }

    let birthYear: number;
    let gender: 'male' | 'female' | 'other' | 'prefer_not_to_say';
    let schoolId: string;
    let aggregateSchoolId: string;
    let sidoCode: string | null;
    let sigunguCode: string | null;

    if (body.profile) {
      const ensuredSchool = await ensureSchool(body.profile.school);
      birthYear = body.profile.birthYear;
      gender = body.profile.gender;
      schoolId = ensuredSchool.schoolId;
      aggregateSchoolId = ensuredSchool.aggregateSchoolId;
      sidoCode = ensuredSchool.schoolRow.sido_code;
      sigunguCode = ensuredSchool.schoolRow.sigungu_code;

      if (voterUserId) {
        const { error: updateUserError } = await supabase
          .from('users')
          .update({
            birth_year: birthYear,
            gender,
            school_id: schoolId,
            sido_code: sidoCode,
            sigungu_code: sigunguCode,
          })
          .eq('id', voterUserId);

        if (updateUserError) {
          return NextResponse.json({ error: updateUserError.message }, { status: 500 });
        }
      }
    } else {
      if (!voterUserId) {
        return NextResponse.json(
          { error: '비로그인 투표에는 최초 프로필 정보가 필요합니다.' },
          { status: 400 },
        );
      }

      const { data: userRow, error: userRowError } = await supabase
        .from('users')
        .select('birth_year, gender, school_id, sido_code, sigungu_code')
        .eq('id', voterUserId)
        .maybeSingle();

      if (userRowError) {
        return NextResponse.json({ error: userRowError.message }, { status: 500 });
      }

      if (!userRow?.birth_year || !userRow?.gender || !userRow?.school_id) {
        return NextResponse.json(
          { error: '최초 투표를 위해 나이, 성별, 학교 정보를 먼저 입력해 주세요.' },
          { status: 400 },
        );
      }

      const schoolIdentity = await getSchoolIdentityById(userRow.school_id);
      if (!schoolIdentity) {
        return NextResponse.json({ error: '저장된 학교 정보를 찾을 수 없습니다.' }, { status: 400 });
      }

      birthYear = userRow.birth_year;
      gender = userRow.gender as 'male' | 'female' | 'other' | 'prefer_not_to_say';
      schoolId = schoolIdentity.schoolId;
      aggregateSchoolId = schoolIdentity.aggregateSchoolId;
      sidoCode = userRow.sido_code ?? schoolIdentity.sidoCode;
      sigunguCode = userRow.sigungu_code ?? schoolIdentity.sigunguCode;
    }

    if (voterUserId) {
      const { data: insertedVote, error: voteInsertError } = await supabase
        .from('votes')
        .insert({
          topic_id: body.topicId,
          option_key: body.optionKey,
          user_id: voterUserId,
          guest_token: null,
          school_id: schoolId,
          aggregate_school_id: aggregateSchoolId,
          birth_year: birthYear,
          gender,
          sido_code: sidoCode,
          sigungu_code: sigunguCode,
        })
        .select('id, topic_id, option_key, user_id, created_at')
        .single();

      if (voteInsertError) {
        if (voteInsertError.code === '23505') {
          return NextResponse.json({ error: '이미 해당 주제에 투표했습니다.' }, { status: 409 });
        }
        return NextResponse.json({ error: voteInsertError.message }, { status: 500 });
      }

      return NextResponse.json({ vote: insertedVote }, { status: 201 });
    }

    if (!guestSessionId) {
      return NextResponse.json({ error: 'guest session이 유효하지 않습니다.' }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const { error: sessionUpsertError } = await supabase
      .from('guest_vote_sessions')
      .upsert({ id: guestSessionId, last_seen_at: nowIso }, { onConflict: 'id' });

    if (sessionUpsertError) {
      return NextResponse.json({ error: sessionUpsertError.message }, { status: 500 });
    }

    const { data: insertedTempVote, error: tempVoteInsertError } = await supabase
      .from('guest_votes_temp')
      .insert({
        session_id: guestSessionId,
        topic_id: body.topicId,
        option_key: body.optionKey,
        school_id: schoolId,
        aggregate_school_id: aggregateSchoolId,
        sido_code: sidoCode,
        sigungu_code: sigunguCode,
      })
      .select('id, topic_id, option_key, voted_at')
      .single();

    if (tempVoteInsertError) {
      if (tempVoteInsertError.code === '23505') {
        return NextResponse.json({ error: '이미 해당 주제에 투표했습니다.' }, { status: 409 });
      }
      return NextResponse.json({ error: tempVoteInsertError.message }, { status: 500 });
    }

    return NextResponse.json(
      {
        vote: {
          ...insertedTempVote,
          session_id: guestSessionId,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'vote submit failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
