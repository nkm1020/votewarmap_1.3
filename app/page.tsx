import { headers } from 'next/headers';
import MainMapHome from '@/components/MainMapHome';
import { resolveCountryCodeFromHeaders } from '@/lib/server/country-policy';

export default async function Home() {
  const headerStore = await headers();
  const initialCountryCode = resolveCountryCodeFromHeaders(headerStore);
  return <MainMapHome initialCountryCode={initialCountryCode} />;
}
