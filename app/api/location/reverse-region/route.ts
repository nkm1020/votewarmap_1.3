import { NextResponse } from 'next/server';
import { z } from 'zod';
import { reverseGeocodeRegion } from '@/lib/server/reverse-region';

export const runtime = 'nodejs';

const requestSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export async function POST(request: Request) {
  try {
    const rawBody = (await request.json()) as unknown;
    const parsed = requestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '잘못된 요청 형식입니다.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await reverseGeocodeRegion(parsed.data);
    if (!result) {
      return NextResponse.json({ error: '위치에서 지역 정보를 확인하지 못했습니다.' }, { status: 422 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'reverse region failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
