import type { VoteRegionInputByGps } from '@/lib/vote/types';

type ReverseRegionResponse = {
  sidoCode?: string;
  sigunguCode?: string | null;
  sidoName?: string | null;
  sigunguName?: string | null;
  provider?: string | null;
  error?: string;
};

function toAccuracy(accuracy: number | null | undefined): number | null {
  return typeof accuracy === 'number' && Number.isFinite(accuracy) ? accuracy : null;
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error('위치 기능을 사용할 수 없는 환경입니다.');
  }

  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0,
    });
  });
}

export async function resolveVoteRegionInputFromCurrentLocation(): Promise<VoteRegionInputByGps> {
  const position = await getCurrentPosition();
  const latitude = position.coords.latitude;
  const longitude = position.coords.longitude;
  const accuracy = toAccuracy(position.coords.accuracy);

  const response = await fetch('/api/location/reverse-region', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ latitude, longitude }),
  });

  const json = (await response.json()) as ReverseRegionResponse;
  if (!response.ok) {
    throw new Error(json.error ?? '위치에서 지역 정보를 확인하지 못했습니다.');
  }

  const sidoCode = String(json.sidoCode ?? '').trim();
  if (!sidoCode) {
    throw new Error('시/도 정보를 확인하지 못했습니다.');
  }

  const sigunguCode = typeof json.sigunguCode === 'string' ? json.sigunguCode : null;
  const provider = typeof json.provider === 'string' ? json.provider : null;

  return {
    source: 'gps',
    location: {
      latitude,
      longitude,
      accuracy,
    },
    region: {
      sidoCode,
      sigunguCode,
      sidoName: typeof json.sidoName === 'string' ? json.sidoName : null,
      sigunguName: typeof json.sigunguName === 'string' ? json.sigunguName : null,
      provider,
    },
  };
}
