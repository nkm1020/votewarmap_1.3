import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { isGpsEnabled, normalizeCountryCode, resolveCountryCodeFromRequest } from '@/lib/server/country-policy';
import { ensureSchool, getSchoolIdentityById } from '@/lib/server/schools';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const schoolSchema = z.object({
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
});

const regionInputSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('school'),
    school: schoolSchema,
  }),
  z.object({
    source: z.literal('gps'),
    location: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracy: z.number().min(0).nullable(),
    }),
    region: z.object({
      sidoCode: z.string().min(2),
      sigunguCode: z.string().min(5).nullable(),
      sidoName: z.string().nullable(),
      sigunguName: z.string().nullable(),
      provider: z.string().nullable(),
    }),
  }),
]);

const voteBodySchema = z.object({
  topicId: z.string().min(1),
  optionKey: z.string().min(1),
  guestSessionId: z.string().uuid().optional(),
  regionInput: regionInputSchema.optional(),
});

type UserRegionRow = {
  birth_year: number | null;
  gender: 'male' | 'female' | 'other' | 'prefer_not_to_say' | null;
  school_id: string | null;
  country_code: string | null;
  sido_code: string | null;
  sigungu_code: string | null;
  signup_completed_at: string | null;
};

const REGION_REQUIRED_ERROR = '투표를 위해 학교를 선택하거나 정확한 위치를 설정해 주세요.';
const SIGNUP_COMPLETION_REQUIRED_ERROR = '투표 전에 회원가입 정보를 먼저 입력해 주세요.';
const SCHOOL_UPDATE_FROM_VOTE_FORBIDDEN_ERROR = '학교 설정/변경은 MY 편집에서만 가능합니다.';
const GPS_ONLY_FOR_NO_SCHOOL_ERROR = '학교 미설정 계정은 정확한 위치 사용(GPS)으로만 투표할 수 있어요.';
const GPS_COMING_SOON_FOR_KR_ERROR = '국내 사용자는 GPS 위치 기능이 출시 예정입니다. 학교를 선택해 주세요.';
const SCHOOL_REQUIRED_FOR_KR_MEMBER_ERROR = '국내 사용자는 학교 등록 후 투표할 수 있어요. MY에서 학교를 등록해 주세요.';
const SCHOOL_ONLY_FOR_KR_GUEST_ERROR = '국내 비회원은 학교 위치로만 투표할 수 있어요. 학교를 선택해 주세요.';
const CROSS_COUNTRY_VOTE_FORBIDDEN_ERROR = '다른 국가 주제는 조회만 가능하며 투표는 소속 국가에서만 가능합니다.';

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
    const { data: topicRow, error: topicError } = await supabase
      .from('vote_topics')
      .select('id, country_code')
      .eq('id', body.topicId)
      .maybeSingle();

    if (topicError) {
      return NextResponse.json({ error: topicError.message }, { status: 500 });
    }
    if (!topicRow) {
      return NextResponse.json({ error: '주제를 찾을 수 없습니다.' }, { status: 404 });
    }
    const topicCountryCode = normalizeCountryCode((topicRow as { country_code?: string | null }).country_code);

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

    let schoolId: string | null = null;
    let aggregateSchoolId: string | null = null;
    let sidoCode: string | null = null;
    let sigunguCode: string | null = null;
    let birthYearSnapshot: number | null = null;
    let genderSnapshot: 'male' | 'female' | 'other' | 'prefer_not_to_say' | null = null;
    let userRegionRow: UserRegionRow | null = null;
    const requestCountryCode = resolveCountryCodeFromRequest(request);
    let resolvedCountryCode = requestCountryCode;

    if (voterUserId) {
      const { data: row, error: rowError } = await supabase
        .from('users')
        .select('birth_year, gender, school_id, country_code, sido_code, sigungu_code, signup_completed_at')
        .eq('id', voterUserId)
        .maybeSingle();

      if (rowError) {
        return NextResponse.json({ error: rowError.message }, { status: 500 });
      }

      userRegionRow = (row as UserRegionRow | null) ?? null;
      resolvedCountryCode = normalizeCountryCode(userRegionRow?.country_code);
      if (!userRegionRow?.signup_completed_at) {
        return NextResponse.json({ error: SIGNUP_COMPLETION_REQUIRED_ERROR }, { status: 403 });
      }

      birthYearSnapshot = userRegionRow?.birth_year ?? null;
      genderSnapshot = userRegionRow?.gender ?? null;
    }

    if (topicCountryCode !== resolvedCountryCode) {
      return NextResponse.json({ error: CROSS_COUNTRY_VOTE_FORBIDDEN_ERROR }, { status: 403 });
    }

    if (body.regionInput?.source === 'gps' && !isGpsEnabled(resolvedCountryCode)) {
      return NextResponse.json({ error: GPS_COMING_SOON_FOR_KR_ERROR }, { status: 400 });
    }

    if (voterUserId) {
      const existingSchoolId = userRegionRow?.school_id ?? null;
      const isKrUser = !isGpsEnabled(resolvedCountryCode);
      if (existingSchoolId) {
        if (body.regionInput?.source === 'school') {
          return NextResponse.json({ error: SCHOOL_UPDATE_FROM_VOTE_FORBIDDEN_ERROR }, { status: 400 });
        }

        const schoolIdentity = await getSchoolIdentityById(existingSchoolId);
        if (!schoolIdentity) {
          return NextResponse.json({ error: '저장된 학교 정보를 찾을 수 없습니다.' }, { status: 400 });
        }

        schoolId = schoolIdentity.schoolId;
        aggregateSchoolId = schoolIdentity.aggregateSchoolId;
        sidoCode = userRegionRow?.sido_code ?? schoolIdentity.sidoCode;
        sigunguCode = userRegionRow?.sigungu_code ?? schoolIdentity.sigunguCode;
      } else {
        if (isKrUser) {
          return NextResponse.json({ error: SCHOOL_REQUIRED_FOR_KR_MEMBER_ERROR }, { status: 400 });
        }

        if (body.regionInput?.source === 'school') {
          return NextResponse.json({ error: GPS_ONLY_FOR_NO_SCHOOL_ERROR }, { status: 400 });
        }

        if (body.regionInput?.source !== 'gps') {
          return NextResponse.json({ error: GPS_ONLY_FOR_NO_SCHOOL_ERROR }, { status: 400 });
        }

        schoolId = null;
        aggregateSchoolId = null;
        sidoCode = body.regionInput.region.sidoCode;
        sigunguCode = body.regionInput.region.sigunguCode ?? null;

        const { error: updateUserError } = await supabase
          .from('users')
          .update({
            sido_code: sidoCode,
            sigungu_code: sigunguCode,
          })
          .eq('id', voterUserId);

        if (updateUserError) {
          return NextResponse.json({ error: updateUserError.message }, { status: 500 });
        }
      }
    } else if (body.regionInput) {
      if (!isGpsEnabled(resolvedCountryCode) && body.regionInput.source === 'gps') {
        return NextResponse.json({ error: SCHOOL_ONLY_FOR_KR_GUEST_ERROR }, { status: 400 });
      }

      if (body.regionInput.source === 'school') {
        const ensuredSchool = await ensureSchool(body.regionInput.school);
        schoolId = ensuredSchool.schoolId;
        aggregateSchoolId = ensuredSchool.aggregateSchoolId;
        sidoCode = ensuredSchool.schoolRow.sido_code;
        sigunguCode = ensuredSchool.schoolRow.sigungu_code;
      } else {
        schoolId = null;
        aggregateSchoolId = null;
        sidoCode = body.regionInput.region.sidoCode;
        sigunguCode = body.regionInput.region.sigunguCode ?? null;
      }
    } else {
      return NextResponse.json({ error: REGION_REQUIRED_ERROR }, { status: 400 });
    }

    if (!sidoCode && !sigunguCode) {
      return NextResponse.json({ error: REGION_REQUIRED_ERROR }, { status: 400 });
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
          birth_year: birthYearSnapshot,
          gender: genderSnapshot,
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
