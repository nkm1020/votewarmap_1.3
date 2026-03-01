import type { PersonaTag } from '@/lib/vote/types';
export type PersonaDominant = 'egen' | 'teto' | 'golden_balance' | 'none';

export type PersonaPowerMetrics = {
  egenCount: number;
  tetoCount: number;
  mappedVotes: number;
  egenPercent: number;
  tetoPercent: number;
  dominant: PersonaDominant;
};

function sanitizeCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

export function normalizePersonaTag(value: string | null | undefined): PersonaTag | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'egen' || normalized === 'teto') {
    return normalized;
  }
  return null;
}

export function calculatePersonaPowerFromCounts(
  input: {
    egenCount: number;
    tetoCount: number;
  },
): PersonaPowerMetrics {
  const egenCount = sanitizeCount(input.egenCount);
  const tetoCount = sanitizeCount(input.tetoCount);
  const mappedVotes = egenCount + tetoCount;

  if (mappedVotes <= 0) {
    return {
      egenCount: 0,
      tetoCount: 0,
      mappedVotes: 0,
      egenPercent: 0,
      tetoPercent: 0,
      dominant: 'none',
    };
  }

  const egenPercent = Math.round((egenCount / mappedVotes) * 100);
  const tetoPercent = Math.max(0, 100 - egenPercent);

  let dominant: PersonaDominant = 'golden_balance';
  if (egenPercent > tetoPercent) {
    dominant = 'egen';
  } else if (tetoPercent > egenPercent) {
    dominant = 'teto';
  }

  return {
    egenCount,
    tetoCount,
    mappedVotes,
    egenPercent,
    tetoPercent,
    dominant,
  };
}

export function calculatePersonaPowerFromOptionCounts(
  input: {
    countA: number;
    countB: number;
    optionATag: PersonaTag | null;
    optionBTag: PersonaTag | null;
  },
): PersonaPowerMetrics {
  const countA = sanitizeCount(input.countA);
  const countB = sanitizeCount(input.countB);
  let egenCount = 0;
  let tetoCount = 0;

  if (input.optionATag === 'egen') {
    egenCount += countA;
  } else if (input.optionATag === 'teto') {
    tetoCount += countA;
  }

  if (input.optionBTag === 'egen') {
    egenCount += countB;
  } else if (input.optionBTag === 'teto') {
    tetoCount += countB;
  }

  return calculatePersonaPowerFromCounts({ egenCount, tetoCount });
}
