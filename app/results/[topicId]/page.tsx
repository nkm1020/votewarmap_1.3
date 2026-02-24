import { ResultComparisonPage } from '@/components/results/ResultComparisonPage';

type ResultPageProps = {
  params: Promise<{
    topicId: string;
  }>;
};

export default async function ResultPage({ params }: ResultPageProps) {
  const { topicId } = await params;
  return <ResultComparisonPage topicId={topicId} />;
}
