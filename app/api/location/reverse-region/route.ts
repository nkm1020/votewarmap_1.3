import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveCountryCodeFromRequest } from '@/lib/server/country-policy';
import { resolveCountryRegionFromPoint } from '@/lib/server/country-region-geo';
import { reverseGeocodeRegion } from '@/lib/server/reverse-region';

export const runtime = 'nodejs';

const requestSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export async function POST(request: Request) {
  try {
    const countryCode = resolveCountryCodeFromRequest(request);

    const rawBody = (await request.json()) as unknown;
    const parsed = requestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '잘못된 요청 형식입니다.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    if (countryCode === 'KR') {
      const result = await reverseGeocodeRegion(parsed.data);
      if (!result) {
        return NextResponse.json({ error: '위치에서 지역 정보를 확인하지 못했습니다.' }, { status: 422 });
      }

      return NextResponse.json(result);
    }

    const result = resolveCountryRegionFromPoint({
      countryCode,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
    });
    if (!result) {
      return NextResponse.json({ error: '위치에서 지역 정보를 확인하지 못했습니다.' }, { status: 422 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'reverse region failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
