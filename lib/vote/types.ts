export type Gender = 'male' | 'female' | 'other' | 'prefer_not_to_say';

export type SchoolLevel = 'middle' | 'high' | 'university' | 'graduate';

export type VoterType = 'guest' | 'user';

export type SchoolSource = 'nais' | 'local_xls';

export type RegionLevel = 'sido' | 'sigungu';

export type RegionWinner = 'A' | 'B' | 'TIE';

export type RegionVoteStat = {
  winner?: RegionWinner;
  total?: number;
  countA?: number;
  countB?: number;
  gapPercent?: number;
};

export type RegionVoteMap = Record<string, RegionVoteStat>;

export type SchoolSearchItem = {
  id?: string;
  source: SchoolSource;
  schoolCode: string;
  schoolName: string;
  schoolLevel: SchoolLevel;
  campusType: string | null;
  parentSchoolId: string | null;
  sidoName: string | null;
  sidoCode: string | null;
  sigunguName: string | null;
  sigunguCode: string | null;
  address: string | null;
  isActive: boolean;
};

export type VoteRegionSource = 'school' | 'gps';

export type VoteRegionInputBySchool = {
  source: 'school';
  school: SchoolSearchItem;
};

export type VoteRegionInputByGps = {
  source: 'gps';
  location: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
  };
  region: {
    sidoCode: string;
    sigunguCode: string | null;
    sidoName: string | null;
    sigunguName: string | null;
    provider: string | null;
  };
};

export type VoteRegionInput = VoteRegionInputBySchool | VoteRegionInputByGps;

export type VoteTopicOption = {
  key: string;
  label: string;
  position: 1 | 2;
};

export type VoteTopic = {
  id: string;
  title: string;
  status: string;
  options: VoteTopicOption[];
};

export type AgeBucketKey = 'teens' | 'twenties' | 'thirties' | 'forties' | 'fiftiesPlus';

export type AgeBucketStat = {
  count: number;
  percent: number;
};

export type GenderBreakdown = {
  male: {
    count: number;
    percent: number;
  };
  female: {
    count: number;
    percent: number;
  };
  otherCount: number;
  unknownCount: number;
  knownBinaryTotal: number;
};

export type HomeAnalyticsResponse = {
  demographics: {
    source: 'votes_members_only';
    scope: string;
    totalMemberVotes: number;
    age: {
      buckets: Record<AgeBucketKey, AgeBucketStat>;
      knownTotal: number;
      unknownCount: number;
      referenceYear: number;
    };
    gender: GenderBreakdown;
  };
};
