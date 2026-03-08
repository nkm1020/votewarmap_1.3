import type { PersonaTag } from '@/lib/vote/types';

export type ResultVisibility = 'locked' | 'unlocked';
export type PersonaDominant = 'egen' | 'teto' | 'golden_balance' | 'none';

export type VoteSummaryStat = {
  countA: number;
  countB: number;
  totalVotes: number;
  winner: 'A' | 'B' | 'TIE';
  aPercent: number;
  bPercent: number;
};

export type PersonaPowerSummary = {
  egenPercent: number;
  tetoPercent: number;
  dominant: PersonaDominant;
  mappedVotes: number;
};

export type VoteResultViewer = {
  type: 'user' | 'guest' | 'anonymous';
  hasVote: boolean;
  hasTopicVote: boolean;
  hasVoteInScope: boolean;
  countryCode: string;
  voteCountryCode: string | null;
};

export type VoteResultSummaryResponse = {
  scopeCountryCode: string;
  topic: {
    id: string;
    title: string;
    status: string;
    optionA: { key: string; label: string; position: 1; personaTag: PersonaTag | null };
    optionB: { key: string; label: string; position: 2; personaTag: PersonaTag | null };
  };
  viewer: VoteResultViewer;
  visibility: ResultVisibility;
  preview: {
    gapPercent: number;
    totalVotes: number;
  } | null;
  nationwide: VoteSummaryStat | null;
  myRegion:
    | (VoteSummaryStat & {
        level: 'sido' | 'sigungu';
        code: string;
        name: string;
        centroid: {
          lat: number;
          lng: number;
        } | null;
      })
    | null;
  persona: {
    nationwide: PersonaPowerSummary | null;
    myRegion: PersonaPowerSummary | null;
  };
  myChoice:
    | {
        optionKey: string;
        label: string | null;
        matchesNationwide: boolean | null;
        matchesMyRegion: boolean | null;
      }
    | null;
};

export type VoteResultSummaryUnlockedResponse = VoteResultSummaryResponse & {
  visibility: 'unlocked';
  preview: null;
  nationwide: VoteSummaryStat;
};

export type VoteResultSummaryLockedResponse = VoteResultSummaryResponse & {
  visibility: 'locked';
  preview: {
    gapPercent: number;
    totalVotes: number;
  };
  nationwide: null;
  myRegion: null;
  myChoice: null;
  persona: {
    nationwide: null;
    myRegion: null;
  };
};

export function buildViewerVoteState(countryCode: string): VoteResultViewer {
  return {
    type: 'anonymous',
    hasVote: false,
    hasTopicVote: false,
    hasVoteInScope: false,
    countryCode,
    voteCountryCode: null,
  };
}

export function hasCrossCountryTopicVote(
  viewer: Pick<VoteResultViewer, 'hasTopicVote' | 'voteCountryCode'> | null | undefined,
  scopeCountryCode: string | null | undefined,
): boolean {
  if (!viewer?.hasTopicVote || !viewer.voteCountryCode || !scopeCountryCode) {
    return false;
  }

  return viewer.voteCountryCode !== scopeCountryCode;
}
