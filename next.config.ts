import type { NextConfig } from "next";

const SUPABASE_ORIGIN = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) {
    return null;
  }

  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
})();

const SCRIPT_SRC = [
  "'self'",
  "'unsafe-inline'",
  ...(process.env.NODE_ENV !== 'production' ? ["'unsafe-eval'"] : []),
  'https://pagead2.googlesyndication.com',
  'https://www.googletagservices.com',
];

const STYLE_SRC = [
  "'self'",
  "'unsafe-inline'",
];

const CONNECT_SRC = [
  "'self'",
  SUPABASE_ORIGIN ?? '',
  'https://*.supabase.co',
  'wss://*.supabase.co',
  'https://vitals.vercel-insights.com',
  'https://pagead2.googlesyndication.com',
  'https://googleads.g.doubleclick.net',
  'https://basemaps.cartocdn.com',
  'https://demotiles.maplibre.org',
  'https://grainy-gradients.vercel.app',
].filter(Boolean);

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src ${SCRIPT_SRC.join(' ')}`,
  `style-src ${STYLE_SRC.join(' ')}`,
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://demotiles.maplibre.org",
  `connect-src ${CONNECT_SRC.join(' ')}`,
  "frame-src 'self' https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://www.google.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "form-action 'self'",
  ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
