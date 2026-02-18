export const POPULAR_TOPIC_ID = 'popular-vote';
export const POPULAR_OPTION_A = 'seoul';
export const POPULAR_OPTION_B = 'busan';

export const LOCAL_STORAGE_KEYS = {
  guestToken: 'vwm_guest_token',
  pendingProfile: 'vwm_pending_profile',
  pendingVotes: 'vwm_pending_votes',
  cachedRegionStatsPopular: 'vwm_cached_region_stats_popular',
} as const;

export const GENDER_LABEL: Record<string, string> = {
  male: '남성',
  female: '여성',
  other: '기타',
  prefer_not_to_say: '응답안함',
};
