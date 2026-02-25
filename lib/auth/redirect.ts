export function normalizeInternalRedirectPath(value: string | null | undefined): string {
  if (!value) {
    return '/';
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/';
  }

  try {
    const parsed = new URL(trimmed, 'https://votewarmap.local');
    const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (!normalized.startsWith('/') || normalized.startsWith('//')) {
      return '/';
    }
    if (normalized === '/auth' || normalized.startsWith('/auth/')) {
      return '/';
    }
    return normalized;
  } catch {
    return '/';
  }
}
