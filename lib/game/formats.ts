import {
  GAME_FORMAT_IDS,
  type GameFormatDefinition,
  type GameFormatId,
  type PublicGameFormat,
} from '@/lib/game/types';
import {
  generateChaosMixRound,
  generateClassicHigherLowerRound,
  generateMarginBucketRound,
  generateOutlierRegionRound,
  generateSchoolHotspotDuelRound,
  generateStrengthDuelRound,
  generateTieHunterRound,
  generateTopicDuelSameRegionRound,
  generateTurnoutDuelRound,
  generateWinnerPickRound,
  normalizeScoreTo100,
} from '@/lib/game/generator';

const defaultCurve = {
  rampEvery: 4,
  hardStartRound: 10,
} as const;

export const GAME_FORMAT_DEFINITIONS: readonly GameFormatDefinition[] = [
  {
    id: 'classic_higher_lower',
    label: '클래식 배틀',
    description: '기존 A/B/동률 예측 포맷',
    questionType: 'three_way',
    lives: 3,
    difficultyCurve: defaultCurve,
    generator: generateClassicHigherLowerRound,
    normalize: normalizeScoreTo100,
  },
  {
    id: 'winner_pick',
    label: '승자 맞히기',
    description: '한 문제의 최종 승자(A/B/TIE) 예측',
    questionType: 'three_way',
    lives: 3,
    difficultyCurve: defaultCurve,
    generator: generateWinnerPickRound,
    normalize: normalizeScoreTo100,
  },
  {
    id: 'margin_bucket',
    label: '격차 구간',
    description: '득표 격차의 구간을 맞히는 포맷',
    questionType: 'four_way',
    lives: 3,
    difficultyCurve: defaultCurve,
    generator: generateMarginBucketRound,
    normalize: normalizeScoreTo100,
  },
  {
    id: 'turnout_duel',
    label: '참여도 대결',
    description: '같은 주제에서 참여 투표수 많은 지역 고르기',
    questionType: 'two_way',
    lives: 3,
    difficultyCurve: defaultCurve,
    generator: generateTurnoutDuelRound,
    normalize: normalizeScoreTo100,
  },
  {
    id: 'strength_duel',
    label: '우세 강도 대결',
    description: '격차가 더 큰 지역 선택',
    questionType: 'two_way',
    lives: 3,
    difficultyCurve: defaultCurve,
    generator: generateStrengthDuelRound,
    normalize: normalizeScoreTo100,
  },
  {
    id: 'topic_duel_same_region',
    label: '주제 대결',
    description: '같은 지역에서 A 비율이 더 높은 주제 고르기',
    questionType: 'two_way',
    lives: 3,
    difficultyCurve: defaultCurve,
    generator: generateTopicDuelSameRegionRound,
    normalize: normalizeScoreTo100,
  },
  {
    id: 'tie_hunter',
    label: '동률 탐지기',
    description: '결과가 동률인지 아닌지 판별',
    questionType: 'boolean',
    lives: 3,
    difficultyCurve: defaultCurve,
    generator: generateTieHunterRound,
    normalize: normalizeScoreTo100,
  },
  {
    id: 'outlier_region',
    label: '아웃라이어 지역',
    description: '가장 극단적인 격차 지역 찾기',
    questionType: 'four_way',
    lives: 3,
    difficultyCurve: defaultCurve,
    generator: generateOutlierRegionRound,
    normalize: normalizeScoreTo100,
  },
  {
    id: 'school_hotspot_duel',
    label: '학교 핫스팟 대결',
    description: '지역 대표 학교 투표량 비교',
    questionType: 'two_way',
    lives: 3,
    difficultyCurve: defaultCurve,
    generator: generateSchoolHotspotDuelRound,
    normalize: normalizeScoreTo100,
  },
  {
    id: 'chaos_mix',
    label: '카오스 믹스',
    description: '여러 포맷이 라운드마다 랜덤 혼합',
    questionType: 'mixed',
    lives: 3,
    difficultyCurve: defaultCurve,
    generator: generateChaosMixRound,
    normalize: normalizeScoreTo100,
  },
] as const;

const formatById = new Map<GameFormatId, GameFormatDefinition>(
  GAME_FORMAT_DEFINITIONS.map((format) => [format.id, format]),
);

export function isGameFormatId(value: string): value is GameFormatId {
  return (GAME_FORMAT_IDS as readonly string[]).includes(value);
}

export function getGameFormatById(modeId: GameFormatId): GameFormatDefinition {
  const found = formatById.get(modeId);
  if (!found) {
    throw new Error(`Unknown game mode: ${modeId}`);
  }
  return found;
}

export function getPublicGameFormats(): PublicGameFormat[] {
  return GAME_FORMAT_DEFINITIONS.map((format) => ({
    id: format.id,
    label: format.label,
    description: format.description,
    questionType: format.questionType,
    lives: format.lives,
    timeLimitMs: format.timeLimitMs,
    difficultyCurve: format.difficultyCurve,
    normalizeRule: {
      type: 'cap_100',
    },
  }));
}
