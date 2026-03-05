import { createHmac } from 'node:crypto';
import { resolveCountryCodeFromRequest } from '@/lib/server/country-policy';
import { resolveClientIp } from '@/lib/server/request-rate-limit';

const MAX_USER_AGENT_LENGTH = 256;
const MAX_ACCEPT_LANGUAGE_LENGTH = 128;

function resolveFingerprintSecret(): string {
  const explicit = process.env.GUEST_FINGERPRINT_SECRET?.trim();
  if (explicit) {
    return explicit;
  }

  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (fallback) {
    return fallback;
  }

  if (process.env.NODE_ENV !== 'production') {
    return 'local-dev-guest-fingerprint-secret';
  }

  throw new Error('GUEST_FINGERPRINT_SECRET 또는 SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.');
}

export function buildGuestFingerprintHash(request: Request): string {
  const secret = resolveFingerprintSecret();
  const ip = resolveClientIp(request);
  const userAgent = (request.headers.get('user-agent') ?? '').trim().slice(0, MAX_USER_AGENT_LENGTH);
  const acceptLanguage =
    (request.headers.get('accept-language') ?? '').trim().slice(0, MAX_ACCEPT_LANGUAGE_LENGTH);
  const countryCode = resolveCountryCodeFromRequest(request);

  const payload = `${ip}|${userAgent}|${acceptLanguage}|${countryCode}`;
  return createHmac('sha256', secret).update(payload).digest('hex');
}
