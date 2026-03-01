const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const DEFAULT_COUNTRY_CODE = 'KR';
const COUNTRY_CODE_ALIASES: Record<string, string> = {
  GB: 'UK',
};

export function normalizeCountryCode(raw: string | null | undefined): string {
  const normalized = String(raw ?? '').trim().toUpperCase();
  if (COUNTRY_CODE_PATTERN.test(normalized)) {
    return COUNTRY_CODE_ALIASES[normalized] ?? normalized;
  }
  return DEFAULT_COUNTRY_CODE;
}

export function resolveCountryCodeFromHeaders(headers: Headers): string {
  return normalizeCountryCode(
    headers.get('x-vercel-ip-country') ??
      headers.get('cf-ipcountry') ??
      headers.get('x-country-code'),
  );
}

export function resolveCountryCodeFromRequest(request: Request): string {
  return resolveCountryCodeFromHeaders(request.headers);
}

export function isGpsEnabled(countryCode: string | null | undefined): boolean {
  return normalizeCountryCode(countryCode) !== 'KR';
}
