import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveCountryCodeFromRequest } from '@/lib/server/country-policy';
import { resolveCountryRegionFromPoint } from '@/lib/server/country-region-geo';
import { checkRateLimit, resolveClientIp } from '@/lib/server/request-rate-limit';
import { reverseGeocodeRegion } from '@/lib/server/reverse-region';
import { internalServerError } from '@/lib/server/api-response';

export const runtime = 'nodejs';
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

const requestSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export async function POST(request: Request) {
  try {
    const rateLimit = await checkRateLimit({
      scope: 'reverse-region',
      key: resolveClientIp(request),
      maxRequests: RATE_LIMIT_MAX_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    if (rateLimit.limited) {
      return NextResponse.json(
        { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimit.retryAfterSec),
          },
        },
      );
    }

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
    return internalServerError('app/api/location/reverse-region/route.ts', error);
  }
}
