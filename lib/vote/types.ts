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

export type VoteProfileInput = {
  birthYear: number;
  gender: Gender;
  school: SchoolSearchItem;
};

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
