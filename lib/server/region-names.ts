import fs from 'node:fs';
import path from 'node:path';

type RegionFeature = {
  properties?: {
    code?: string;
    name?: string;
  };
};

type RegionCollection = {
  features?: RegionFeature[];
};

let sidoByCodeCache: Map<string, string> | null = null;
let sigunguByCodeCache: Map<string, string> | null = null;

function loadRegions(fileName: string): Map<string, string> {
  const filePath = path.join(process.cwd(), 'public', 'data', fileName);
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as RegionCollection;
  const map = new Map<string, string>();

  (parsed.features ?? []).forEach((feature) => {
    const code = String(feature.properties?.code ?? '').trim();
    const name = String(feature.properties?.name ?? '').trim();
    if (!code || !name) {
      return;
    }
    map.set(code, name);
  });

  return map;
}

function getSidoByCodeMap(): Map<string, string> {
  if (!sidoByCodeCache) {
    sidoByCodeCache = loadRegions('skorea_provinces_geo_simple.json');
  }
  return sidoByCodeCache;
}

function getSigunguByCodeMap(): Map<string, string> {
  if (!sigunguByCodeCache) {
    sigunguByCodeCache = loadRegions('skorea_municipalities_geo_simple.json');
  }
  return sigunguByCodeCache;
}

function buildCodeCandidates(code: string | null | undefined, expectedLength: 2 | 5): string[] {
  const raw = String(code ?? '').trim();
  if (!raw) {
    return [];
  }

  const digits = raw.replace(/\D/g, '');
  const candidates = new Set<string>();

  const push = (value: string) => {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    candidates.add(normalized);
    if (normalized.length > expectedLength) {
      candidates.add(normalized.slice(0, expectedLength));
    }
  };

  push(raw);
  push(digits);

  if (expectedLength === 2 && digits.length >= 5) {
    candidates.add(digits.slice(0, 2));
  }
  if (expectedLength === 5 && digits.length >= 2) {
    candidates.add(digits.slice(0, 5));
  }

  return Array.from(candidates);
}

export function getSidoNameByCode(code: string | null | undefined): string | null {
  const map = getSidoByCodeMap();
  const candidates = buildCodeCandidates(code, 2);
  for (const candidate of candidates) {
    const name = map.get(candidate);
    if (name) {
      return name;
    }
  }
  return null;
}

export function getSigunguNameByCode(code: string | null | undefined): string | null {
  const map = getSigunguByCodeMap();
  const candidates = buildCodeCandidates(code, 5);
  for (const candidate of candidates) {
    const name = map.get(candidate);
    if (name) {
      return name;
    }
  }
  return null;
}

export function getRegionNameByCodes(args: {
  sidoCode?: string | null;
  sigunguCode?: string | null;
}): string | null {
  const sigunguName = getSigunguNameByCode(args.sigunguCode);
  if (sigunguName) {
    return sigunguName;
  }
  return getSidoNameByCode(args.sidoCode) ?? null;
}
