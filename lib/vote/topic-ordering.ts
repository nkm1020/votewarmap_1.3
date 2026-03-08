const TOPIC_PREFIX_COUNTRY_CODES = new Set([
  'KR',
  'US',
  'JP',
  'CN',
  'UK',
  'IE',
  'DE',
  'FR',
  'IT',
]);

function normalizeCountryCode(countryCode: string): string {
  return countryCode.trim().toUpperCase();
}

function extractTopicPrefix(topicId: string): string {
  const [prefix = ''] = topicId.trim().split('-', 1);
  return prefix.toUpperCase();
}

export function getTopicCountryPrefixMatch(topicId: string, countryCode: string): number {
  const prefix = extractTopicPrefix(topicId);
  if (!TOPIC_PREFIX_COUNTRY_CODES.has(prefix)) {
    return 0;
  }

  return prefix === normalizeCountryCode(countryCode) ? 1 : 0;
}

export function sortTopicsByCountryTieBreak<T extends { id: string; title: string }>(
  topics: T[],
  countryCode: string,
): T[] {
  return [...topics].sort((a, b) => {
    const prefixDiff =
      getTopicCountryPrefixMatch(b.id, countryCode) -
      getTopicCountryPrefixMatch(a.id, countryCode);
    if (prefixDiff !== 0) {
      return prefixDiff;
    }

    const titleDiff = a.title.localeCompare(b.title, 'ko');
    if (titleDiff !== 0) {
      return titleDiff;
    }

    return a.id.localeCompare(b.id, 'ko');
  });
}
