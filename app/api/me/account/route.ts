import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromAuthorizationHeader } from '@/lib/server/auth';
import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { internalServerError } from '@/lib/server/api-response';

export const runtime = 'nodejs';

const deleteAccountBodySchema = z.object({
  confirmationText: z.literal('탈퇴'),
});

export async function DELETE(request: Request) {
  try {
    const user = await resolveUserFromAuthorizationHeader(request.headers.get('authorization'));
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    let requestBody: unknown;
    try {
      requestBody = (await request.json()) as unknown;
    } catch {
      return NextResponse.json({ error: '요청 본문이 올바른 JSON 형식이 아닙니다.' }, { status: 400 });
    }

    const parsed = deleteAccountBodySchema.safeParse(requestBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '확인 문구가 올바르지 않습니다.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const supabase = getSupabaseServiceRoleClient();
    const { error } = await supabase.auth.admin.deleteUser(user.id, false);
    if (error) {
      return internalServerError('app/api/me/account/route.ts', error.message);
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'account delete failed';
    return internalServerError('app/api/me/account/route.ts', message);
  }
}
