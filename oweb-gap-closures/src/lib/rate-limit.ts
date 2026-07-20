/**
 * Fixed-window rate limiter (pattern from OpenClaw webhook-ingress).
 */

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

export function createFixedWindowRateLimiter(opts: {
  maxRequests: number;
  windowMs: number;
}): (key: string) => RateLimitResult {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (key: string): RateLimitResult => {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      return { allowed: true };
    }
    if (bucket.count >= opts.maxRequests) {
      return { allowed: false, retryAfterMs: bucket.resetAt - now };
    }
    bucket.count += 1;
    return { allowed: true };
  };
}
