/**
 * In-memory rate limiter for API endpoints.
 * 
 * Uses a sliding window counter per key (IP or email).
 * Suitable for single-instance deployments (Vercel serverless).
 * For multi-instance deployments, use Upstash Redis instead.
 * 
 * Usage:
 *   const limiter = createRateLimiter({ windowMs: 60_000, maxHits: 10 });
 *   const result = limiter.check(clientIp);
 *   if (!result.allowed) return Response.json({ error: 'Too many requests' }, { status: 429 });
 */

interface RateLimiterConfig {
  /** Time window in milliseconds */
  windowMs: number;
  /** Maximum number of requests per window */
  maxHits: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

interface HitRecord {
  count: number;
  windowStart: number;
}

export function createRateLimiter(config: RateLimiterConfig) {
  const store = new Map<string, HitRecord>();

  // Cleanup stale entries every 60 seconds
  const CLEANUP_INTERVAL = 60_000;
  let lastCleanup = Date.now();

  function cleanup() {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL) return;
    lastCleanup = now;

    for (const [key, record] of store.entries()) {
      if (now - record.windowStart > config.windowMs * 2) {
        store.delete(key);
      }
    }
  }

  return {
    check(key: string): RateLimitResult {
      cleanup();
      const now = Date.now();
      const record = store.get(key);

      // New key or expired window
      if (!record || now - record.windowStart > config.windowMs) {
        store.set(key, { count: 1, windowStart: now });
        return {
          allowed: true,
          remaining: config.maxHits - 1,
          resetAt: now + config.windowMs,
        };
      }

      // Within window
      record.count++;
      const allowed = record.count <= config.maxHits;

      return {
        allowed,
        remaining: Math.max(0, config.maxHits - record.count),
        resetAt: record.windowStart + config.windowMs,
      };
    },

    /** Reset a specific key (e.g., after successful login) */
    reset(key: string) {
      store.delete(key);
    },
  };
}

// ─── Pre-configured limiters ────────────────────────────────

/** Login: 5 attempts per minute per IP */
export const loginLimiter = createRateLimiter({
  windowMs: 60_000,    // 1 minute
  maxHits: 5,
});

/** API general: 60 requests per minute per IP */
export const apiLimiter = createRateLimiter({
  windowMs: 60_000,    // 1 minute
  maxHits: 60,
});

/** Financial operations: 10 per minute */
export const financialLimiter = createRateLimiter({
  windowMs: 60_000,
  maxHits: 10,
});

/**
 * Extract client IP from request headers.
 * Works with Vercel, Cloudflare, and standard proxies.
 */
export function getClientIp(request: Request): string {
  const headers = request.headers;
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    headers.get('cf-connecting-ip') ||
    'unknown'
  );
}
