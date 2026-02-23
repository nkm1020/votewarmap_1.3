export type GeocodeProvider = 'kakao' | 'nominatim';

export type GeocodeInput = {
  schoolName: string;
  address?: string | null;
  sidoName?: string | null;
  sigunguName?: string | null;
  timeoutMs?: number;
};

export type GeocodeResult = {
  latitude: number;
  longitude: number;
  provider: GeocodeProvider;
  query: string;
};

type KakaoKeywordResponse = {
  documents?: Array<{
    x?: string;
    y?: string;
  }>;
};

type NominatimResponseItem = {
  lat?: string;
  lon?: string;
};

const DEFAULT_TIMEOUT_MS = 8000;

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function buildCandidateQueries(input: GeocodeInput): string[] {
  const schoolName = normalizeText(input.schoolName);
  const address = normalizeText(input.address);
  const sidoName = normalizeText(input.sidoName);
  const sigunguName = normalizeText(input.sigunguName);

  const queries = [
    `${schoolName} ${sigunguName} ${sidoName} 대한민국`.trim(),
    `${schoolName} ${sidoName} 대한민국`.trim(),
    `${schoolName} 대한민국`.trim(),
    address,
  ].filter(Boolean);

  return Array.from(new Set(queries));
}

function normalizeCoordinate(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
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

async function geocodeWithKakao(query: string, timeoutMs: number): Promise<GeocodeResult | null> {
  const kakaoApiKey = process.env.KAKAO_REST_API_KEY;
  if (!kakaoApiKey) {
    return null;
  }

  const params = new URLSearchParams({
    query,
    size: '1',
  });

  const payload = await fetchJsonWithTimeout<KakaoKeywordResponse>(
    `https://dapi.kakao.com/v2/local/search/keyword.json?${params.toString()}`,
    {
      headers: {
        Authorization: `KakaoAK ${kakaoApiKey}`,
      },
    },
    timeoutMs,
  );

  const item = payload?.documents?.[0];
  const lng = normalizeCoordinate(item?.x);
  const lat = normalizeCoordinate(item?.y);

  if (lat === null || lng === null) {
    return null;
  }

  return {
    latitude: lat,
    longitude: lng,
    provider: 'kakao',
    query,
  };
}

async function geocodeWithNominatim(query: string, timeoutMs: number): Promise<GeocodeResult | null> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'kr',
    'accept-language': 'ko',
  });

  const payload = await fetchJsonWithTimeout<NominatimResponseItem[]>(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    {
      headers: {
        'User-Agent':
          process.env.GEOCODER_USER_AGENT ?? 'votewarmap/1.0 (school geocoding backfill)',
      },
    },
    timeoutMs,
  );

  const item = payload?.[0];
  const lat = normalizeCoordinate(item?.lat);
  const lng = normalizeCoordinate(item?.lon);

  if (lat === null || lng === null) {
    return null;
  }

  return {
    latitude: lat,
    longitude: lng,
    provider: 'nominatim',
    query,
  };
}

export async function geocodeSchool(input: GeocodeInput): Promise<GeocodeResult | null> {
  const queries = buildCandidateQueries(input);
  if (queries.length === 0) {
    return null;
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (const query of queries) {
    const kakaoResult = await geocodeWithKakao(query, timeoutMs);
    if (kakaoResult) {
      return kakaoResult;
    }
  }

  for (const query of queries) {
    const nominatimResult = await geocodeWithNominatim(query, timeoutMs);
    if (nominatimResult) {
      return nominatimResult;
    }
  }

  return null;
}
