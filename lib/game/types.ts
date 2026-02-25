export const GAME_FORMAT_IDS = [
  'classic_higher_lower',
  'winner_pick',
  'margin_bucket',
  'turnout_duel',
  'strength_duel',
  'topic_duel_same_region',
  'tie_hunter',
  'outlier_region',
  'school_hotspot_duel',
  'chaos_mix',
] as const;

export type GameFormatId = (typeof GAME_FORMAT_IDS)[number];

export type GameQuestionType = 'three_way' | 'two_way' | 'four_way' | 'boolean' | 'mixed';

export type DifficultyBucket = 'easy' | 'normal' | 'hard';

export type GameDifficultyCurve = {
  rampEvery: number;
  hardStartRound: number;
};

export type TopicMeta = {
  topicId: string;
  title: string;
  optionAKey: string;
  optionALabel: string;
  optionBKey: string;
  optionBLabel: string;
};

export type RegionFact = {
  id: string;
  topicId: string;
  topicTitle: string;
  regionCode: string;
  regionLevel: 'sido' | 'sigungu';
  regionName: string;
  totalVotes: number;
  optionAKey: string;
  optionALabel: string;
  optionBKey: string;
  optionBLabel: string;
  aPercent: number;
  bPercent: number;
  winner: 'A' | 'B' | 'TIE';
  margin: number;
};

export type SchoolFact = {
  id: string;
  regionCode: string;
  regionLevel: 'sido' | 'sigungu';
  regionName: string;
  schoolId: string;
  schoolName: string;
  voteCount: number;
  latitude: number | null;
  longitude: number | null;
};

export type GameFactPool = {
  regionFacts: RegionFact[];
  schoolFacts: SchoolFact[];
  topicMeta: TopicMeta[];
};

export type GeneratedOption = {
  id: string;
  label: string;
};

export type RoundAnswer = {
  optionId: string;
};

export type GeneratedRound = {
  modeId: GameFormatId;
  signature: string;
  prompt: string;
  subPrompt?: string;
  options: GeneratedOption[];
  answer: RoundAnswer;
  infoLine?: string;
};

export type RoundGenerationContext = {
  roundIndex: number;
  score: number;
  lives: number;
  difficulty: DifficultyBucket;
  usedSignatures: Set<string>;
  recentSignatures: Set<string>;
};

export type GameModeGenerator = (
  context: RoundGenerationContext,
  factPool: GameFactPool,
) => GeneratedRound | null;

export type GameFormatDefinition = {
  id: GameFormatId;
  label: string;
  description: string;
  questionType: GameQuestionType;
  lives: number;
  timeLimitMs?: number;
  difficultyCurve: GameDifficultyCurve;
  generator: GameModeGenerator;
  normalize: (rawScore: number) => number;
};

export type PublicGameFormat = Omit<GameFormatDefinition, 'generator' | 'normalize'> & {
  normalizeRule: {
    type: 'cap_100';
  };
};

export type GameFormatsResponse = {
  items: PublicGameFormat[];
  meta: {
    itemCount: number;
    randomStrategy: 'fully_random';
  };
};

export type GameFactsResponse = {
  regionFacts: RegionFact[];
  schoolFacts: SchoolFact[];
  topicMeta: TopicMeta[];
  meta: {
    topicCount: number;
    regionFactCount: number;
    schoolFactCount: number;
  };
};

export type GameScoreSubmitRequest = {
  runId: string;
  modeId: GameFormatId;
  rawScore: number;
  normalizedScore: number;
  meta?: Record<string, unknown>;
};

export type GameScoreSubmitResponse = {
  saved: true;
  duplicated?: boolean;
  bestModeRawScore: number;
  bestGlobalNormalizedScore: number;
};

export type GameLeaderboardItem = {
  rank: number;
  displayName: string;
  score: number;
  achievedAt: string;
};

export type GameLeaderboardResponse = {
  items: GameLeaderboardItem[];
  meta: {
    modeId: GameFormatId | 'all';
    period: 'daily' | 'weekly' | 'all';
    limit: number;
    itemCount: number;
    timezone: 'Asia/Seoul';
  };
};
