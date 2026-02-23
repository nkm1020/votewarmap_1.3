const OPTION_SUBTEXT_MAP: Record<string, Record<string, string>> = {
  'food-lifelong-noodle-vs-rice': {
    noodles_only: '',
    rice_only: '',
  },
  'food-soft-vs-hard-peach': {
    soft_peach: '',
    hard_peach: '',
  },
  'food-no-cola-chicken-vs-no-kimchi-ramen': {
    no_cola_chicken: '',
    no_kimchi_ramen: '',
  },
  'food-mintchoco-vs-no-chocolate': {
    mintchoco_forever: '',
    no_chocolate_forever: '',
  },
  'rel-lover-passenger-vs-friend-passenger': {
    lover_car_friend_passenger: '',
    friend_car_lover_passenger: '',
  },
  'rel-lover-peel-shrimp-vs-friend-peel-shrimp': {
    lover_peels_friend_shrimp: '',
    friend_peels_lover_shrimp: '',
  },
  'rel-ghosting-vs-rebound-breakup': {
    ghosting_breakup: '',
    rebound_breakup: '',
  },
  'rel-slow-long-vs-fast-short-reply': {
    slow_long_reply: '',
    fast_short_reply: '',
  },
  'work-competent-toxic-boss-vs-kind-incompetent-boss': {
    competent_toxic_boss: '',
    kind_incompetent_boss: '',
  },
  'work-long-commute-bigco-vs-nearby-sme': {
    long_commute_bigco: '',
    nearby_sme: '',
  },
  'work-highpay-6day-vs-lowpay-4day': {
    highpay_sixday: '',
    lowpay_fourday: '',
  },
  'work-invisible-vs-levitation-10cm': {
    invisibility: '',
    levitation_10cm: '',
  },
  'imagination-past-lotto-vs-future-spouse': {
    past_lotto: '',
    future_spouse: '',
  },
  'imagination-all-languages-vs-best-looks': {
    all_languages_master: '',
    best_looks: '',
  },
  'imagination-army-winter-vs-summer': {
    army_winter_2y: '',
    army_summer_2y: '',
  },
};

export function getOptionSubtext(topicId: string | null | undefined, optionKey: string | null | undefined): string {
  if (!topicId || !optionKey) {
    return '';
  }

  return OPTION_SUBTEXT_MAP[topicId]?.[optionKey] ?? '';
}

export function getOptionSubtextMap(): Record<string, Record<string, string>> {
  return OPTION_SUBTEXT_MAP;
}
