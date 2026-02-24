import { getSigunguNameByCode, getSidoNameByCode } from '@/lib/server/region-names';
import { resolveSidoCode, resolveSigunguCode } from '@/lib/server/regions';

export type ReverseRegionProvider = 'kakao' | 'nominatim';

export type ReverseRegionResult = {
  sidoCode: string;
  sigunguCode: string | null;
  sidoName: string | null;
  sigunguName: string | null;
  provider: ReverseRegionProvider;
};

const DEFAULT_TIMEOUT_MS = 8000;

type KakaoCoordResponse = {
  documents?: Array<{
    region_type?: string;
    code?: string;
    address_name?: string;
    region_1depth_name?: string;
    region_2depth_name?: string;
  }>;
};

type NominatimReverseResponse = {
  display_name?: string;
  address?: {
    state?: string;
    province?: string;
    city?: string;
    county?: string;
    town?: string;
    municipality?: string;
  };
};

function normalizeCode(code: string | null | undefined): string | null {
  const cleaned = String(code ?? '').trim();
  return cleaned.length > 0 ? cleaned : null;
}

async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildResult(args: {
  sidoCode: string;
  sigunguCode?: string | null;
  provider: ReverseRegionProvider;
}): ReverseRegionResult {
  const sidoCode = args.sidoCode;
  const sigunguCode = args.sigunguCode ?? null;
  return {
    sidoCode,
    sigunguCode,
    sidoName: getSidoNameByCode(sidoCode),
    sigunguName: getSigunguNameByCode(sigunguCode),
    provider: args.provider,
  };
}

async function reverseRegionWithKakao(
  latitude: number,
  longitude: number,
  timeoutMs: number,
): Promise<ReverseRegionResult | null> {
  const kakaoApiKey = process.env.KAKAO_REST_API_KEY;
  if (!kakaoApiKey) {
    return null;
  }

  const params = new URLSearchParams({
    x: String(longitude),
    y: String(latitude),
  });

  const payload = await fetchJsonWithTimeout<KakaoCoordResponse>(
    `https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?${params.toString()}`,
    {
      headers: {
        Authorization: `KakaoAK ${kakaoApiKey}`,
      },
    },
    timeoutMs,
  );

  const candidate =
    payload?.documents?.find((doc) => doc.region_type === 'H') ?? payload?.documents?.[0] ?? null;
  if (!candidate) {
    return null;
  }

  const code = normalizeCode(candidate.code);
  const sidoName = candidate.region_1depth_name ?? null;
  const sigunguName = candidate.region_2depth_name ?? null;

  const sidoCodeFromName = resolveSidoCode(sidoName);
  const sidoCodeFromCode = code && code.length >= 2 ? code.slice(0, 2) : null;
  const sidoCode = sidoCodeFromName ?? sidoCodeFromCode;
  if (!sidoCode) {
    return null;
  }

  const sigunguCodeFromCode = code && code.length >= 5 ? code.slice(0, 5) : null;
  const sigunguResolved = resolveSigunguCode({
    sidoCode,
    sigunguName,
    address: candidate.address_name ?? null,
  }).sigunguCode;

  return buildResult({
    sidoCode,
    sigunguCode: sigunguResolved ?? sigunguCodeFromCode,
    provider: 'kakao',
  });
}

async function reverseRegionWithNominatim(
  latitude: number,
  longitude: number,
  timeoutMs: number,
): Promise<ReverseRegionResult | null> {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    format: 'jsonv2',
    'accept-language': 'ko',
    addressdetails: '1',
  });

  const payload = await fetchJsonWithTimeout<NominatimReverseResponse>(
    `https://nominatim.openstreetmap.org/reverse?${params.toString()}`,
    {
      headers: {
        'User-Agent':
          process.env.GEOCODER_USER_AGENT ?? 'votewarmap/1.0 (reverse geocoding)',
      },
    },
    timeoutMs,
  );

  if (!payload) {
    return null;
  }

  const stateName = payload.address?.state ?? payload.address?.province ?? null;
  const sidoCode = resolveSidoCode(stateName);
  if (!sidoCode) {
    return null;
  }

  const sigunguName =
    payload.address?.city ??
    payload.address?.county ??
    payload.address?.town ??
    payload.address?.municipality ??
    null;
  const sigunguCode = resolveSigunguCode({
    sidoCode,
    sigunguName,
    address: payload.display_name ?? null,
  }).sigunguCode;

  return buildResult({
    sidoCode,
    sigunguCode,
    provider: 'nominatim',
  });
}

export async function reverseGeocodeRegion(args: {
  latitude: number;
  longitude: number;
  timeoutMs?: number;
}): Promise<ReverseRegionResult | null> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const kakaoResult = await reverseRegionWithKakao(args.latitude, args.longitude, timeoutMs);
  if (kakaoResult) {
    return kakaoResult;
  }

  return reverseRegionWithNominatim(args.latitude, args.longitude, timeoutMs);
}
