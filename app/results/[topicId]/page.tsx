import { ResultComparisonPage } from '@/components/results/ResultComparisonPage';

type ResultPageProps = {
  params: Promise<{
    topicId: string;
  }>;
  searchParams?: Promise<{
    country?: string | string[];
    entry?: string | string[];
    view?: string | string[];
  }>;
};

function pickQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export default async function ResultPage({ params, searchParams }: ResultPageProps) {
  const { topicId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const country = pickQueryValue(resolvedSearchParams.country);
  const entry = pickQueryValue(resolvedSearchParams.entry);
  const view = pickQueryValue(resolvedSearchParams.view);
  const entryMode: 'default' | 'map' = entry === 'history' && view === 'map' ? 'map' : 'default';
  return <ResultComparisonPage topicId={topicId} entryMode={entryMode} initialCountryCode={country} />;
}
