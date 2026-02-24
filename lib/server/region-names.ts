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

export function getSidoNameByCode(code: string | null | undefined): string | null {
  if (!code) {
    return null;
  }
  return getSidoByCodeMap().get(code) ?? null;
}

export function getSigunguNameByCode(code: string | null | undefined): string | null {
  if (!code) {
    return null;
  }
  return getSigunguByCodeMap().get(code) ?? null;
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
