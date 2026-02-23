import Link from 'next/link';

type ResultPageProps = {
  params: Promise<{
    topicId: string;
  }>;
};

export default async function ResultPage({ params }: ResultPageProps) {
  const { topicId } = await params;

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <section className="mx-auto w-full max-w-[640px] rounded-3xl border border-white/12 bg-[rgba(18,18,22,0.72)] p-6 shadow-[0_16px_40px_rgba(0,0,0,0.35)] backdrop-blur-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#ff9f0a]">Result (Placeholder)</p>
        <h1 className="mt-2 text-2xl font-bold">투표 결과 페이지 준비 중</h1>
        <p className="mt-3 text-sm text-white/70">topicId: {topicId}</p>

        <div className="mt-6 flex gap-3">
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-semibold text-white/90 transition hover:bg-white/15"
          >
            홈으로
          </Link>
          <Link
            href="/topics-map"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-[#ff9f0a66] bg-[#ff6b00] px-4 text-sm font-semibold text-white transition hover:bg-[#ff7c1f]"
          >
            Topics Map
          </Link>
        </div>
      </section>
    </main>
  );
}
