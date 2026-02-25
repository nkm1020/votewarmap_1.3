import type {
  DifficultyBucket,
  GameFactPool,
  GameFormatId,
  GeneratedOption,
  GeneratedRound,
  RegionFact,
  RoundGenerationContext,
  SchoolFact,
} from '@/lib/game/types';

const NON_CHAOS_MODE_IDS: GameFormatId[] = [
  'classic_higher_lower',
  'winner_pick',
  'margin_bucket',
  'turnout_duel',
  'strength_duel',
  'topic_duel_same_region',
  'tie_hunter',
  'outlier_region',
  'school_hotspot_duel',
];

function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) {
    return null;
  }
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = next[i];
    next[i] = next[j] as T;
    next[j] = tmp as T;
  }
  return next;
}

function buildOptions(options: Array<{ id: string; label: string }>): GeneratedOption[] {
  return options.map((item) => ({ id: item.id, label: item.label }));
}

function normalizeTopicPairId(topicIdA: string, topicIdB: string): string {
  return [topicIdA, topicIdB].sort().join('|');
}

function normalizeRegionPairId(regionA: string, regionB: string): string {
  return [regionA, regionB].sort().join('|');
}

function difficultyFilteredFacts(regionFacts: RegionFact[], difficulty: DifficultyBucket): RegionFact[] {
  if (regionFacts.length === 0) {
    return [];
  }

  if (difficulty === 'easy') {
    const easy = regionFacts.filter((fact) => fact.margin >= 15);
    return easy.length > 0 ? easy : regionFacts;
  }

  if (difficulty === 'hard') {
    const hard = regionFacts.filter((fact) => fact.margin <= 8);
    return hard.length > 0 ? hard : regionFacts;
  }

  return regionFacts;
}

function pickTwoDistinctRegionFacts(
  regionFacts: RegionFact[],
  matcher: (first: RegionFact, second: RegionFact) => boolean,
): [RegionFact, RegionFact] | null {
  if (regionFacts.length < 2) {
    return null;
  }

  for (let i = 0; i < 100; i += 1) {
    const first = pickRandom(regionFacts);
    if (!first) {
      continue;
    }

    const candidates = regionFacts.filter((fact) => fact.id !== first.id && matcher(first, fact));
    const second = pickRandom(candidates);
    if (!second) {
      continue;
    }

    return [first, second];
  }

  return null;
}

function pickTwoDistinctSchoolFacts(schoolFacts: SchoolFact[]): [SchoolFact, SchoolFact] | null {
  if (schoolFacts.length < 2) {
    return null;
  }

  for (let i = 0; i < 100; i += 1) {
    const first = pickRandom(schoolFacts);
    if (!first) {
      continue;
    }

    const candidates = schoolFacts.filter(
      (fact) => fact.id !== first.id && fact.voteCount !== first.voteCount,
    );
    const second = pickRandom(candidates);
    if (!second) {
      continue;
    }

    return [first, second];
  }

  return null;
}

function marginBucketLabel(margin: number): { id: string; label: string } {
  if (margin <= 3) {
    return { id: 'bucket_0_3', label: '0~3%p' };
  }
  if (margin <= 10) {
    return { id: 'bucket_4_10', label: '4~10%p' };
  }
  if (margin <= 20) {
    return { id: 'bucket_11_20', label: '11~20%p' };
  }
  return { id: 'bucket_21_plus', label: '21%p 이상' };
}

export function generateClassicHigherLowerRound(
  context: RoundGenerationContext,
  factPool: GameFactPool,
): GeneratedRound | null {
  const scoped = difficultyFilteredFacts(factPool.regionFacts, context.difficulty);
  const fact = pickRandom(scoped);
  if (!fact) {
    return null;
  }

  const answerId = fact.winner === 'A' ? 'A' : fact.winner === 'B' ? 'B' : 'TIE';
  const options = buildOptions([
    { id: 'A', label: fact.optionALabel },
    { id: 'B', label: fact.optionBLabel },
    { id: 'TIE', label: '동률' },
  ]);

  return {
    modeId: 'classic_higher_lower',
    signature: `classic:${fact.id}`,
    prompt: `${fact.regionName} · ${fact.topicTitle}`,
    subPrompt: '어느 쪽이 더 높을까요?',
    options,
    answer: { optionId: answerId },
    infoLine: `${fact.optionALabel} ${fact.aPercent}% : ${fact.optionBLabel} ${fact.bPercent}%`,
  };
}

export function generateWinnerPickRound(
  context: RoundGenerationContext,
  factPool: GameFactPool,
): GeneratedRound | null {
  const scoped = difficultyFilteredFacts(factPool.regionFacts, context.difficulty);
  const fact = pickRandom(scoped);
  if (!fact) {
    return null;
  }

  const answerId = fact.winner === 'A' ? 'A' : fact.winner === 'B' ? 'B' : 'TIE';
  const options = buildOptions([
    { id: 'A', label: fact.optionALabel },
    { id: 'B', label: fact.optionBLabel },
    { id: 'TIE', label: '동률' },
  ]);

  return {
    modeId: 'winner_pick',
    signature: `winner:${fact.id}`,
    prompt: `${fact.regionName} · ${fact.topicTitle}`,
    subPrompt: '최종 승자를 맞혀보세요.',
    options,
    answer: { optionId: answerId },
    infoLine: `격차 ${fact.margin}%p`,
  };
}

export function generateMarginBucketRound(
  context: RoundGenerationContext,
  factPool: GameFactPool,
): GeneratedRound | null {
  const scoped = difficultyFilteredFacts(factPool.regionFacts, context.difficulty);
  const fact = pickRandom(scoped);
  if (!fact) {
    return null;
  }

  const answerBucket = marginBucketLabel(fact.margin);
  const options = buildOptions([
    { id: 'bucket_0_3', label: '0~3%p' },
    { id: 'bucket_4_10', label: '4~10%p' },
    { id: 'bucket_11_20', label: '11~20%p' },
    { id: 'bucket_21_plus', label: '21%p 이상' },
  ]);

  return {
    modeId: 'margin_bucket',
    signature: `margin:${fact.id}`,
    prompt: `${fact.regionName} · ${fact.topicTitle}`,
    subPrompt: 'A/B 격차가 어느 구간인지 맞혀보세요.',
    options,
    answer: { optionId: answerBucket.id },
    infoLine: `${fact.optionALabel} ${fact.aPercent}% : ${fact.optionBLabel} ${fact.bPercent}%`,
  };
}

export function generateTurnoutDuelRound(
  _context: RoundGenerationContext,
  factPool: GameFactPool,
): GeneratedRound | null {
  const pair = pickTwoDistinctRegionFacts(
    factPool.regionFacts,
    (first, second) => first.topicId === second.topicId && first.totalVotes !== second.totalVotes,
  );
  if (!pair) {
    return null;
  }

  const [first, second] = pair;
  const answerId = first.totalVotes > second.totalVotes ? 'left' : 'right';
  const options = buildOptions([
    { id: 'left', label: first.regionName },
    { id: 'right', label: second.regionName },
  ]);

  return {
    modeId: 'turnout_duel',
    signature: `turnout:${first.topicId}:${normalizeRegionPairId(first.regionCode, second.regionCode)}`,
    prompt: `${first.topicTitle}`,
    subPrompt: '참여 투표수가 더 많은 지역은?',
    options,
    answer: { optionId: answerId },
    infoLine: `${first.regionName} ${first.totalVotes.toLocaleString()}표 vs ${second.regionName} ${second.totalVotes.toLocaleString()}표`,
  };
}

export function generateStrengthDuelRound(
  _context: RoundGenerationContext,
  factPool: GameFactPool,
): GeneratedRound | null {
  const pair = pickTwoDistinctRegionFacts(
    factPool.regionFacts,
    (first, second) => first.topicId === second.topicId && first.margin !== second.margin,
  );
  if (!pair) {
    return null;
  }

  const [first, second] = pair;
  const answerId = first.margin > second.margin ? 'left' : 'right';
  const options = buildOptions([
    { id: 'left', label: first.regionName },
    { id: 'right', label: second.regionName },
  ]);

  return {
    modeId: 'strength_duel',
    signature: `strength:${first.topicId}:${normalizeRegionPairId(first.regionCode, second.regionCode)}`,
    prompt: `${first.topicTitle}`,
    subPrompt: '승부 강도(격차)가 더 큰 지역은?',
    options,
    answer: { optionId: answerId },
    infoLine: `${first.regionName} ${first.margin}%p vs ${second.regionName} ${second.margin}%p`,
  };
}

export function generateTopicDuelSameRegionRound(
  _context: RoundGenerationContext,
  factPool: GameFactPool,
): GeneratedRound | null {
  const pair = pickTwoDistinctRegionFacts(
    factPool.regionFacts,
    (first, second) =>
      first.regionCode === second.regionCode &&
      first.topicId !== second.topicId &&
      first.aPercent !== second.aPercent,
  );
  if (!pair) {
    return null;
  }

  const [first, second] = pair;
  const answerId = first.aPercent > second.aPercent ? 'left' : 'right';
  const options = buildOptions([
    { id: 'left', label: first.topicTitle },
    { id: 'right', label: second.topicTitle },
  ]);

  return {
    modeId: 'topic_duel_same_region',
    signature: `topicduel:${first.regionCode}:${normalizeTopicPairId(first.topicId, second.topicId)}`,
    prompt: `${first.regionName}`,
    subPrompt: 'A 지지율이 더 높은 주제는?',
    options,
    answer: { optionId: answerId },
    infoLine: `${first.optionALabel} 비율: ${first.aPercent}% vs ${second.aPercent}%`,
  };
}

export function generateTieHunterRound(
  context: RoundGenerationContext,
  factPool: GameFactPool,
): GeneratedRound | null {
  const scoped = difficultyFilteredFacts(factPool.regionFacts, context.difficulty);
  const fact = pickRandom(scoped);
  if (!fact) {
    return null;
  }

  const answerId = fact.winner === 'TIE' ? 'TIE' : 'NOT_TIE';

  return {
    modeId: 'tie_hunter',
    signature: `tiehunter:${fact.id}`,
    prompt: `${fact.regionName} · ${fact.topicTitle}`,
    subPrompt: '이 결과가 동률인지 판별하세요.',
    options: buildOptions([
      { id: 'TIE', label: 'TIE' },
      { id: 'NOT_TIE', label: 'NOT TIE' },
    ]),
    answer: { optionId: answerId },
    infoLine: `${fact.optionALabel} ${fact.aPercent}% : ${fact.optionBLabel} ${fact.bPercent}%`,
  };
}

export function generateOutlierRegionRound(
  _context: RoundGenerationContext,
  factPool: GameFactPool,
): GeneratedRound | null {
  const byTopic = new Map<string, RegionFact[]>();
  factPool.regionFacts.forEach((fact) => {
    const list = byTopic.get(fact.topicId) ?? [];
    list.push(fact);
    byTopic.set(fact.topicId, list);
  });

  const viableTopics = Array.from(byTopic.entries()).filter(([, facts]) => facts.length >= 4);
  if (viableTopics.length === 0) {
    return null;
  }

  for (let i = 0; i < 60; i += 1) {
    const selected = pickRandom(viableTopics);
    if (!selected) {
      continue;
    }

    const [topicId, facts] = selected;
    const options = shuffle(facts).slice(0, 4);
    if (options.length < 4) {
      continue;
    }

    const sorted = [...options].sort((a, b) => b.margin - a.margin);
    const top = sorted[0];
    const second = sorted[1];
    if (!top || !second || top.margin === second.margin) {
      continue;
    }

    const topicTitle = options[0]?.topicTitle ?? topicId;

    return {
      modeId: 'outlier_region',
      signature: `outlier:${topicId}:${options
        .map((item) => item.regionCode)
        .sort()
        .join('|')}`,
      prompt: `${topicTitle}`,
      subPrompt: '아래 4개 중 격차가 가장 극단적인 지역은?',
      options: options.map((fact, index) => ({ id: `opt_${index}`, label: fact.regionName })),
      answer: {
        optionId: options.findIndex((fact) => fact.regionCode === top.regionCode) >= 0
          ? `opt_${options.findIndex((fact) => fact.regionCode === top.regionCode)}`
          : 'opt_0',
      },
      infoLine: `${top.regionName} 격차 ${top.margin}%p`,
    };
  }

  return null;
}

export function generateSchoolHotspotDuelRound(
  _context: RoundGenerationContext,
  factPool: GameFactPool,
): GeneratedRound | null {
  const pair = pickTwoDistinctSchoolFacts(factPool.schoolFacts);
  if (!pair) {
    return null;
  }

  const [first, second] = pair;
  const answerId = first.voteCount > second.voteCount ? 'left' : 'right';

  return {
    modeId: 'school_hotspot_duel',
    signature: `schoolduel:${normalizeRegionPairId(first.schoolId, second.schoolId)}`,
    prompt: '지역 대표 학교 핫스팟 비교',
    subPrompt: '더 많은 투표를 모은 학교는?',
    options: buildOptions([
      { id: 'left', label: `${first.schoolName} (${first.regionName})` },
      { id: 'right', label: `${second.schoolName} (${second.regionName})` },
    ]),
    answer: { optionId: answerId },
    infoLine: `${first.voteCount.toLocaleString()}표 vs ${second.voteCount.toLocaleString()}표`,
  };
}

export function generateChaosMixRound(
  context: RoundGenerationContext,
  factPool: GameFactPool,
): GeneratedRound | null {
  for (let i = 0; i < 30; i += 1) {
    const modeId = pickRandom(NON_CHAOS_MODE_IDS);
    if (!modeId) {
      continue;
    }

    const generated = generateRoundByMode(modeId, context, factPool);
    if (!generated) {
      continue;
    }

    return {
      ...generated,
      modeId: 'chaos_mix',
      signature: `chaos:${generated.signature}`,
      subPrompt: `혼합 모드 · ${generated.subPrompt ?? ''}`.trim(),
    };
  }

  return null;
}

export function generateRoundByMode(
  modeId: GameFormatId,
  context: RoundGenerationContext,
  factPool: GameFactPool,
): GeneratedRound | null {
  switch (modeId) {
    case 'classic_higher_lower':
      return generateClassicHigherLowerRound(context, factPool);
    case 'winner_pick':
      return generateWinnerPickRound(context, factPool);
    case 'margin_bucket':
      return generateMarginBucketRound(context, factPool);
    case 'turnout_duel':
      return generateTurnoutDuelRound(context, factPool);
    case 'strength_duel':
      return generateStrengthDuelRound(context, factPool);
    case 'topic_duel_same_region':
      return generateTopicDuelSameRegionRound(context, factPool);
    case 'tie_hunter':
      return generateTieHunterRound(context, factPool);
    case 'outlier_region':
      return generateOutlierRegionRound(context, factPool);
    case 'school_hotspot_duel':
      return generateSchoolHotspotDuelRound(context, factPool);
    case 'chaos_mix':
      return generateChaosMixRound(context, factPool);
    default:
      return null;
  }
}

export function resolveDifficultyBucket(
  roundIndex: number,
  score: number,
  lives: number,
  curve: { rampEvery: number; hardStartRound: number },
): DifficultyBucket {
  if (lives <= 1 && roundIndex >= 4) {
    return 'hard';
  }

  if (roundIndex >= curve.hardStartRound || score >= curve.hardStartRound) {
    return 'hard';
  }

  if (roundIndex >= curve.rampEvery || score >= curve.rampEvery) {
    return 'normal';
  }

  return 'easy';
}

export function normalizeScoreTo100(rawScore: number): number {
  if (!Number.isFinite(rawScore)) {
    return 0;
  }

  const normalized = Math.trunc(rawScore);
  if (normalized <= 0) {
    return 0;
  }
  if (normalized >= 100) {
    return 100;
  }
  return normalized;
}
