import TopicsMapPage from '@/components/TopicsMapPage';

type SearchParamsValue = string | string[] | undefined;

type TopicsMapRouteProps = {
  searchParams?: Promise<Record<string, SearchParamsValue>> | Record<string, SearchParamsValue>;
};

function toTopicIds(raw: SearchParamsValue): string[] {
  const source = Array.isArray(raw) ? raw.join(',') : raw ?? '';
  const unique = new Set<string>();
  source
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => unique.add(value));

  return Array.from(unique);
}

export default async function TopicsMapRoute({ searchParams }: TopicsMapRouteProps) {
  const resolvedSearchParams = searchParams instanceof Promise ? await searchParams : searchParams ?? {};
  const initialTopicIds = toTopicIds(resolvedSearchParams.topics);

  return <TopicsMapPage initialTopicIds={initialTopicIds} />;
}
