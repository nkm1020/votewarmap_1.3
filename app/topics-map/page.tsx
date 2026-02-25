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

function toBooleanFlag(raw: SearchParamsValue): boolean {
  const source = Array.isArray(raw) ? raw[0] : raw;
  if (typeof source !== 'string') {
    return false;
  }

  const normalized = source.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'open';
}

export default async function TopicsMapRoute({ searchParams }: TopicsMapRouteProps) {
  const resolvedSearchParams = searchParams instanceof Promise ? await searchParams : searchParams ?? {};
  const initialTopicIds = toTopicIds(resolvedSearchParams.topics);
  const openTopicEditorOnMount = toBooleanFlag(resolvedSearchParams.openTopicEditor);

  return <TopicsMapPage initialTopicIds={initialTopicIds} openTopicEditorOnMount={openTopicEditorOnMount} />;
}
