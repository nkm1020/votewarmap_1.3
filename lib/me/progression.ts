export type LevelTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export type LevelInfo = {
  tier: LevelTier;
  xp: number;
  nextXp: number;
  progressPercent: number;
};

export type Badge = {
  id: string;
  label: string;
  unlocked: boolean;
  progress: number;
  target: number;
};

type BadgeInput = {
  totalVotes: number;
  totalGameScore: number;
  recent7DaysTotal: number;
  myRegionMatchRate: number;
  nationwideMatchRate: number;
  regionNationalFlow: number;
  hasSupporterBadge: boolean;
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function toInt(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.trunc(value);
}

export function computeLevel(xpRaw: number): LevelInfo {
  const xp = Math.max(0, toInt(xpRaw));

  if (xp < 150) {
    return {
      tier: 'bronze',
      xp,
      nextXp: 150,
      progressPercent: clamp(Math.round((xp / 150) * 100), 0, 100),
    };
  }

  if (xp < 400) {
    const progress = ((xp - 150) / 250) * 100;
    return {
      tier: 'silver',
      xp,
      nextXp: 400,
      progressPercent: clamp(Math.round(progress), 0, 100),
    };
  }

  if (xp < 800) {
    const progress = ((xp - 400) / 400) * 100;
    return {
      tier: 'gold',
      xp,
      nextXp: 800,
      progressPercent: clamp(Math.round(progress), 0, 100),
    };
  }

  return {
    tier: 'platinum',
    xp,
    nextXp: 800,
    progressPercent: 100,
  };
}

function buildBadge(id: string, label: string, current: number, target: number): Badge {
  const progress = clamp(toInt(current), 0, target);
  return {
    id,
    label,
    unlocked: progress >= target,
    progress,
    target,
  };
}

export function computeBadges(input: BadgeInput): Badge[] {
  return [
    buildBadge('supporter_badge', '후원자 배지', input.hasSupporterBadge ? 1 : 0, 1),
    buildBadge('first_vote', '첫 투표', input.totalVotes, 1),
    buildBadge('vote_100', '백표 달성', input.totalVotes, 100),
    buildBadge('game_300', '게임 누적 300', input.totalGameScore, 300),
    buildBadge('active_week', '주간 활동 20+', input.recent7DaysTotal, 20),
    buildBadge('region_sync_60', '내 지역 일치도 60%', input.myRegionMatchRate, 60),
    buildBadge('flow_reader_70', '지역↔전국 흐름 70%', input.regionNationalFlow, 70),
  ];
}
