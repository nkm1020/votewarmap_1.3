export const POPULAR_TOPIC_ID = 'popular-vote';
export const POPULAR_OPTION_A = 'seoul';
export const POPULAR_OPTION_B = 'busan';

export const LOCAL_STORAGE_KEYS = {
  guestSessionId: 'vwm_guest_session_id',
  legacyGuestToken: 'vwm_guest_token',
  pendingRegionInput: 'vwm_pending_region_input',
  legacyPendingProfile: 'vwm_pending_profile',
  pendingVotes: 'vwm_pending_votes',
  cachedRegionStatsPopular: 'vwm_cached_region_stats_popular',
  resultIntroSeenByTopic: 'vwm_result_intro_seen_by_topic',
} as const;

export const GENDER_LABEL: Record<string, string> = {
  male: '남성',
  female: '여성',
  other: '기타',
  prefer_not_to_say: '응답안함',
};

export const AVATAR_PRESETS = [
  'sun',
  'moon',
  'star',
  'leaf',
  'wave',
  'fire',
  'cloud',
  'spark',
] as const;
