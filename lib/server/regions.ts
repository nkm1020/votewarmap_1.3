import fs from 'node:fs';
import path from 'node:path';

type MunicipalityFeature = {
  properties?: {
    code?: string;
    name?: string;
  };
};

type MunicipalityCollection = {
  features?: MunicipalityFeature[];
};

const SIDO_CODE_MAP: Record<string, string> = {
  서울: '11',
  서울특별시: '11',
  부산: '21',
  부산광역시: '21',
  대구: '22',
  대구광역시: '22',
  인천: '23',
  인천광역시: '23',
  광주: '24',
  광주광역시: '24',
  대전: '25',
  대전광역시: '25',
  울산: '26',
  울산광역시: '26',
  세종: '29',
  세종특별자치시: '29',
  경기: '31',
  경기도: '31',
  강원: '32',
  강원도: '32',
  강원특별자치도: '32',
  충북: '33',
  충청북도: '33',
  충남: '34',
  충청남도: '34',
  전북: '35',
  전라북도: '35',
  전북특별자치도: '35',
  전남: '36',
  전라남도: '36',
  경북: '37',
  경상북도: '37',
  경남: '38',
  경상남도: '38',
  제주: '39',
  제주도: '39',
  제주특별자치도: '39',
};

let municipalitiesCache: Array<{ code: string; name: string; norm: string }> | null = null;
const SIGUNGU_ALIAS_MAP: Record<string, string[]> = {
  미추홀구: ['남구'],
  인천미추홀구: ['남구', '인천남구'],
  인천남구: ['남구', '미추홀구'],
};

function normalizeKorean(value: string): string {
  return value.replace(/\(.*?\)/g, '').replace(/\s+/g, '').trim();
}

function expandSigunguAliases(candidate: string): string[] {
  const norm = normalizeKorean(candidate);
  const aliases = SIGUNGU_ALIAS_MAP[norm] ?? [];
  return [norm, ...aliases.map((alias) => normalizeKorean(alias))];
}

function readMunicipalities(): Array<{ code: string; name: string; norm: string }> {
  if (municipalitiesCache) {
    return municipalitiesCache;
  }

  const filePath = path.join(process.cwd(), 'public', 'data', 'skorea_municipalities_geo_simple.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as MunicipalityCollection;

  municipalitiesCache = (parsed.features ?? [])
    .map((feature) => {
      const code = String(feature.properties?.code ?? '');
      const name = String(feature.properties?.name ?? '');
      return { code, name, norm: normalizeKorean(name) };
    })
    .filter((item) => item.code && item.name);

  return municipalitiesCache;
}

export function resolveSidoCode(sidoName: string | null | undefined): string | null {
  if (!sidoName) {
    return null;
  }

  const key = normalizeKorean(sidoName);
  return SIDO_CODE_MAP[key] ?? null;
}

export function extractSigunguCandidates(address: string | null | undefined): string[] {
  if (!address) {
    return [];
  }

  const tokens = address
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length < 2) {
    return [];
  }

  const candidates = new Set<string>();
  const second = tokens[1] ?? '';
  const third = tokens[2] ?? '';

  if (second) {
    candidates.add(second);
  }

  if (second && third && /구$/.test(third)) {
    candidates.add(`${second}${third}`);
  }

  if (second && third && /군$|시$/.test(second) && /구$/.test(third)) {
    candidates.add(`${second}${third}`);
  }

  return Array.from(candidates);
}

export function resolveSigunguCode(args: {
  sidoCode?: string | null;
  sigunguName?: string | null;
  address?: string | null;
}): { sigunguCode: string | null; sigunguName: string | null } {
  const { sidoCode, sigunguName, address } = args;
  const pool = readMunicipalities().filter((item) => !sidoCode || item.code.startsWith(sidoCode));

  const candidates = [
    ...(sigunguName ? [sigunguName] : []),
    ...extractSigunguCandidates(address),
  ]
    .map((item) => normalizeKorean(item))
    .filter(Boolean);

  if (candidates.length === 0) {
    return { sigunguCode: null, sigunguName: sigunguName ?? null };
  }

  for (const candidate of candidates) {
    const expandedCandidates = expandSigunguAliases(candidate);
    for (const expanded of expandedCandidates) {
      const exact = pool.find((item) => item.norm === expanded);
      if (exact) {
        return { sigunguCode: exact.code, sigunguName: exact.name };
      }

      const suffixMatch = pool.find((item) => item.norm.endsWith(expanded) || expanded.endsWith(item.norm));
      if (suffixMatch) {
        return { sigunguCode: suffixMatch.code, sigunguName: suffixMatch.name };
      }
    }
  }

  return { sigunguCode: null, sigunguName: sigunguName ?? candidates[0] ?? null };
}
