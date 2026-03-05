import { getSupabaseServiceRoleClient } from '@/lib/supabase/server';

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitCheckInput = {
  scope: string;
  key: string;
  maxRequests: number;
  windowMs: number;
};

type RateLimitCheckResult = {
  limited: boolean;
  retryAfterSec: number;
};

type RateLimitRpcRow = {
  allowed?: boolean | null;
  retry_after_seconds?: number | string | null;
};

const globalBuckets = globalThis as typeof globalThis & {
  __vwmRateLimitBuckets?: Map<string, RateLimitBucket>;
};

function getBuckets(): Map<string, RateLimitBucket> {
  if (!globalBuckets.__vwmRateLimitBuckets) {
    globalBuckets.__vwmRateLimitBuckets = new Map<string, RateLimitBucket>();
  }
  return globalBuckets.__vwmRateLimitBuckets;
}

function checkRateLimitInMemory(input: RateLimitCheckInput): RateLimitCheckResult {
  const now = Date.now();
  const buckets = getBuckets();
  const bucketKey = `${input.scope}:${input.key}`;

  if (buckets.size > 2_000) {
    for (const [key, bucket] of buckets.entries()) {
      if (now >= bucket.resetAt) {
        buckets.delete(key);
      }
    }
  }

  const existing = buckets.get(bucketKey);
  if (!existing || now >= existing.resetAt) {
    buckets.set(bucketKey, {
      count: 1,
      resetAt: now + input.windowMs,
    });
    return { limited: false, retryAfterSec: 0 };
  }

  if (existing.count >= input.maxRequests) {
    return {
      limited: true,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { limited: false, retryAfterSec: 0 };
}

export function resolveClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }

  return 'unknown';
}

export async function checkRateLimit(input: RateLimitCheckInput): Promise<RateLimitCheckResult> {
  try {
    const supabase = getSupabaseServiceRoleClient();
    const windowSeconds = Math.max(1, Math.ceil(input.windowMs / 1000));

    const { data, error } = await supabase.rpc('check_request_rate_limit', {
      p_scope: input.scope,
      p_key: input.key,
      p_window_seconds: windowSeconds,
      p_max_requests: input.maxRequests,
    });

    if (error) {
      return checkRateLimitInMemory(input);
    }

    const row = Array.isArray(data)
      ? ((data[0] as RateLimitRpcRow | undefined) ?? null)
      : ((data as RateLimitRpcRow | null) ?? null);

    const allowed = Boolean(row?.allowed);
    const retryAfterRaw = row?.retry_after_seconds;
    const retryAfterParsed =
      typeof retryAfterRaw === 'number'
        ? retryAfterRaw
        : typeof retryAfterRaw === 'string'
          ? Number.parseInt(retryAfterRaw, 10)
          : 0;

    return {
      limited: !allowed,
      retryAfterSec: Number.isFinite(retryAfterParsed) ? Math.max(0, Math.trunc(retryAfterParsed)) : 0,
    };
  } catch {
    return checkRateLimitInMemory(input);
  }
}
