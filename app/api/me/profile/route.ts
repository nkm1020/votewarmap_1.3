import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { ensureSchool } from '@/lib/server/schools';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
const SCHOOL_SLOT_TYPES = ['middle', 'high', 'university', 'graduate'] as const;
type SchoolSlotType = (typeof SCHOOL_SLOT_TYPES)[number];
const schoolSlotSchema = z.enum(SCHOOL_SLOT_TYPES);

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

const schoolSlotUpdateSchema = z.object({
  slotType: schoolSlotSchema,
  school: schoolSchema,
});

const bodySchema = z
  .object({
    nickname: z.string().trim().min(1).max(20).optional(),
    region: z
      .object({
        sidoCode: z.string().trim().min(2),
        sigunguCode: z.string().trim().min(5).nullable().optional(),
        schoolPolicy: z.enum(['keep', 'clear']),
      })
      .optional(),
    school: schoolSchema.optional(),
    schoolSlotUpdate: schoolSlotUpdateSchema.optional(),
    mainSchoolSlot: schoolSlotSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      typeof value.nickname === 'undefined' &&
      typeof value.region === 'undefined' &&
      typeof value.school === 'undefined' &&
      typeof value.schoolSlotUpdate === 'undefined' &&
      typeof value.mainSchoolSlot === 'undefined'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '수정할 항목이 없습니다.',
      });
    }

    const hasSchoolPayload =
      typeof value.school !== 'undefined' ||
      typeof value.schoolSlotUpdate !== 'undefined' ||
      typeof value.mainSchoolSlot !== 'undefined';

    if (typeof value.region !== 'undefined' && hasSchoolPayload) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'region과 school/schoolSlotUpdate/mainSchoolSlot은 동시에 보낼 수 없습니다.',
        path: ['school'],
      });
    }

    if (typeof value.school !== 'undefined' && typeof value.schoolSlotUpdate !== 'undefined') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'school과 schoolSlotUpdate는 동시에 보낼 수 없습니다.',
        path: ['schoolSlotUpdate'],
      });
    }
  });

function schoolLevelToSlot(level: string | null | undefined): SchoolSlotType | null {
  if (level === 'middle' || level === 'high' || level === 'university' || level === 'graduate') {
    return level;
  }
  return null;
}

function mapProfileUpdateError(error: { code?: string; message?: string }): { status: number; message: string } {
  if (error.code === '23505') {
    return { status: 409, message: '이미 사용 중인 사용자명입니다.' };
  }
  if (error.code === '23514') {
    return { status: 400, message: '사용자명 형식이 올바르지 않습니다.' };
  }
  return { status: 500, message: error.message ?? '프로필 저장에 실패했습니다.' };
}

export async function PATCH(request: Request) {
  try {
    const user = await resolveUserFromAuthorizationHeader(request.headers.get('authorization'));
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const rawBody = (await request.json()) as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(rawBody, 'username')) {
      return NextResponse.json({ error: '사용자명은 변경할 수 없습니다.' }, { status: 400 });
    }
    if (Object.prototype.hasOwnProperty.call(rawBody, 'avatarPreset')) {
      return NextResponse.json({ error: '아바타는 자동 랜덤 배정됩니다.' }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '잘못된 요청 형식입니다.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const payload = parsed.data;
    const updates: Record<string, unknown> = {};

    if (typeof payload.nickname !== 'undefined') {
      updates.nickname = payload.nickname;
    }

    if (typeof payload.region !== 'undefined') {
      updates.sido_code = payload.region.sidoCode;
      updates.sigungu_code = payload.region.sigunguCode ?? null;
      if (payload.region.schoolPolicy === 'clear') {
        updates.school_id = null;
        updates.main_school_slot = null;
      }
    }

    const supabase = getSupabaseServiceRoleClient();

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('users')
        .update(updates)
        .eq('id', user.id);

      if (updateError) {
        const mapped = mapProfileUpdateError(updateError);
        return NextResponse.json({ error: mapped.message }, { status: mapped.status });
      }
    }

    const normalizedSlotUpdate =
      payload.schoolSlotUpdate ??
      (payload.school
        ? (() => {
            const slot = schoolLevelToSlot(payload.school.schoolLevel);
            if (!slot) {
              return null;
            }
            return {
              slotType: slot,
              school: payload.school,
            };
          })()
        : null);

    if (payload.school && !normalizedSlotUpdate) {
      return NextResponse.json({ error: '학교 레벨을 중/고/대/대학원 중 하나로 선택해 주세요.' }, { status: 400 });
    }

    if (normalizedSlotUpdate) {
      const ensuredSchool = await ensureSchool(normalizedSlotUpdate.school);
      const { error: schoolSlotError } = await supabase.rpc('upsert_user_school_pool_slot', {
        p_user_id: user.id,
        p_slot_type: normalizedSlotUpdate.slotType,
        p_school_id: ensuredSchool.schoolId,
        p_set_as_main: Boolean(payload.school && typeof payload.mainSchoolSlot === 'undefined'),
      });

      if (schoolSlotError) {
        const message = schoolSlotError.message ?? '학교 슬롯 저장에 실패했습니다.';
        if (schoolSlotError.code === '42883' || message.includes('upsert_user_school_pool_slot')) {
          return NextResponse.json(
            { error: '학교 슬롯 DB 함수가 없습니다. 20260303 마이그레이션을 적용해 주세요.' },
            { status: 500 },
          );
        }
        if (schoolSlotError.code === '42501') {
          return NextResponse.json({ error: '학교 슬롯 DB 함수 실행 권한이 없습니다. 마이그레이션 grant를 확인해 주세요.' }, { status: 500 });
        }
        if (schoolSlotError.code === '23505') {
          return NextResponse.json({ error: '이미 다른 슬롯에 등록된 학교입니다.' }, { status: 409 });
        }
        if (message.includes('is ambiguous')) {
          return NextResponse.json(
            { error: '학교 슬롯 DB 함수 버전이 오래되었습니다. 최신 마이그레이션을 적용해 주세요.' },
            { status: 500 },
          );
        }
        if (message.includes('2회')) {
          return NextResponse.json({ error: message }, { status: 409 });
        }
        if (message.includes('중복 등록')) {
          return NextResponse.json({ error: message }, { status: 409 });
        }
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    if (typeof payload.mainSchoolSlot !== 'undefined') {
      const { error: mainSlotError } = await supabase.rpc('set_user_main_school_slot', {
        p_user_id: user.id,
        p_slot_type: payload.mainSchoolSlot,
      });

      if (mainSlotError) {
        const message = mainSlotError.message ?? '메인 학교 전환에 실패했습니다.';
        if (mainSlotError.code === '42883' || message.includes('set_user_main_school_slot')) {
          return NextResponse.json(
            { error: '메인 학교 전환 DB 함수가 없습니다. 20260303 마이그레이션을 적용해 주세요.' },
            { status: 500 },
          );
        }
        if (mainSlotError.code === '42501') {
          return NextResponse.json({ error: '메인 학교 전환 DB 함수 실행 권한이 없습니다. 마이그레이션 grant를 확인해 주세요.' }, { status: 500 });
        }
        if (message.includes('is ambiguous')) {
          return NextResponse.json(
            { error: '메인 학교 전환 DB 함수 버전이 오래되었습니다. 최신 마이그레이션을 적용해 주세요.' },
            { status: 500 },
          );
        }
        if (message.includes('등록된 학교')) {
          return NextResponse.json({ error: message }, { status: 400 });
        }
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    const { data, error } = await supabase
      .from('users')
      .select(
        'id, email, full_name, nickname, username, avatar_url, avatar_preset, birth_year, gender, school_id, country_code, main_school_slot, school_edit_count, sido_code, sigungu_code, signup_completed_at, privacy_show_leaderboard_name, privacy_show_region, privacy_show_activity_history',
      )
      .eq('id', user.id)
      .single();

    if (error) {
      const mapped = mapProfileUpdateError(error);
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }

    return NextResponse.json({ profile: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'my profile update failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
