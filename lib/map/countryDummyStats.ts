import type { RegionVoteMap, RegionVoteStat } from '@/components/KoreaAdminMap';
import type { SupportedCountry } from '@/lib/map/countryMapRegistry';

export const NON_KR_DUMMY_TOPIC_BY_COUNTRY: Record<Exclude<SupportedCountry, 'KR'>, string> = {
  UK: 'uk_core',
  IE: 'ie_core',
  US: 'us_core',
  JP: 'jp_core',
  CN: 'cn_core',
  DE: 'de_core',
  FR: 'fr_core',
  IT: 'it_core',
};

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }
  return Math.abs(hash >>> 0);
}

function computeCountryDummyStat(country: SupportedCountry, regionCode: string): RegionVoteStat {
  const seed = hashString(`${country}:${regionCode}`);
  const countryBias = country.charCodeAt(0) + country.charCodeAt(1);

  let countA = 120 + ((seed + countryBias * 37) % 740);
  let countB = 120 + ((seed + countryBias * 53) % 740);

  if ((seed + countryBias) % 5 === 0) {
    countA += 110;
    countB = Math.max(80, countB - 45);
  } else if ((seed + countryBias) % 7 === 0) {
    countB += 110;
    countA = Math.max(80, countA - 45);
  }

  if (seed % 19 === 0) {
    countB = countA;
  }

  const total = countA + countB;
  const winner = countA > countB ? 'A' : countB > countA ? 'B' : 'TIE';
  const aPercent = total > 0 ? Math.round((countA / total) * 100) : 0;
  const bPercent = total > 0 ? Math.max(0, 100 - aPercent) : 0;

  return {
    countA,
    countB,
    total,
    winner,
    gapPercent: Math.abs(aPercent - bPercent),
  };
}

export function buildCountryDummyStats(country: SupportedCountry, codes: Iterable<string>): RegionVoteMap {
  const result: RegionVoteMap = {};
  for (const rawCode of codes) {
    const code = String(rawCode ?? '').trim();
    if (!code) {
      continue;
    }
    result[code] = computeCountryDummyStat(country, code);
  }
  return result;
}

export function getNonKrDummyTopicKey(country: SupportedCountry): string | null {
  if (country === 'KR') {
    return null;
  }
  return NON_KR_DUMMY_TOPIC_BY_COUNTRY[country] ?? `${country.toLowerCase()}_core`;
}
