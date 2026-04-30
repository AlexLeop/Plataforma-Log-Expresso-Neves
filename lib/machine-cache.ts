/**
 * Machine API Cache — Server-side in-memory cache with TTL and Stale-While-Revalidate.
 *
 * Provides a transparent caching layer for Machine API GET requests.
 * Cache lives in Node.js process memory (shared across warm serverless invocations).
 *
 * Features:
 * - TTL-based expiration per endpoint
 * - Stale-While-Revalidate: returns stale data immediately while refreshing in background
 * - Pattern-based invalidation for write operations
 * - Automatic cleanup of expired entries
 */

import { machineGet, type MachineResponse } from './machine-api';

// ─── Types ───────────────────────────────────────────────────────

interface CacheEntry<T = unknown> {
  data: MachineResponse<T>;
  createdAt: number;
  ttlMs: number;
  /** If a background revalidation is already in progress */
  revalidating?: boolean;
}

// ─── Cache Store ─────────────────────────────────────────────────

const cache = new Map<string, CacheEntry>();

/** Generate a deterministic cache key from endpoint + params */
function cacheKey(endpoint: string, params?: Record<string, string>): string {
  const paramStr = params ? JSON.stringify(Object.entries(params).sort()) : '';
  return `${endpoint}::${paramStr}`;
}

/** Check if an entry is still fresh */
function isFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.createdAt < entry.ttlMs;
}

/** Check if entry is within SWR window (up to 2x TTL) */
function isStale(entry: CacheEntry): boolean {
  const age = Date.now() - entry.createdAt;
  return age >= entry.ttlMs && age < entry.ttlMs * 2;
}

// ─── Cleanup (runs periodically) ─────────────────────────────────

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let lastCleanup = Date.now();

function maybeCleanup() {
  if (Date.now() - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = Date.now();

  let removed = 0;
  for (const [key, entry] of cache.entries()) {
    // Remove entries older than 2x their TTL (past SWR window)
    if (Date.now() - entry.createdAt > entry.ttlMs * 2) {
      cache.delete(key);
      removed++;
    }
  }

  if (removed > 0) {
    console.log(`[MachineCache] Cleanup: removed ${removed} expired entries, ${cache.size} remaining`);
  }
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Cached Machine API GET request.
 *
 * - If data is fresh (< TTL): returns cached data immediately
 * - If data is stale (TTL < age < 2*TTL): returns cached data AND triggers background refresh
 * - If data is expired (> 2*TTL) or missing: fetches fresh data
 *
 * @param endpoint - Machine API endpoint (e.g., MACHINE_ENDPOINTS.condutor)
 * @param params - Query parameters
 * @param ttlMs - Time-to-live in milliseconds
 */
export async function cachedMachineGet<T = unknown>(
  endpoint: string,
  params?: Record<string, string>,
  ttlMs: number = 2 * 60 * 1000, // default 2 min
): Promise<MachineResponse<T>> {
  maybeCleanup();

  const key = cacheKey(endpoint, params);
  const existing = cache.get(key) as CacheEntry<T> | undefined;

  // ── Fresh hit: return immediately ──
  if (existing && isFresh(existing)) {
    console.log(`[MachineCache] HIT (fresh) ${endpoint}`);
    return existing.data;
  }

  // ── Stale hit: return cached + revalidate in background ──
  if (existing && isStale(existing) && existing.data.ok) {
    if (!existing.revalidating) {
      existing.revalidating = true;
      console.log(`[MachineCache] HIT (stale, revalidating) ${endpoint}`);

      // Background refresh — fire and forget
      machineGet<T>(endpoint, params).then(freshData => {
        if (freshData.ok) {
          cache.set(key, { data: freshData, createdAt: Date.now(), ttlMs });
        } else {
          // Keep stale data on error, just reset revalidating flag
          existing.revalidating = false;
        }
      }).catch(() => {
        existing.revalidating = false;
      });
    }

    return existing.data;
  }

  // ── Miss or expired: fetch fresh ──
  console.log(`[MachineCache] MISS ${endpoint}`);
  const result = await machineGet<T>(endpoint, params);

  // Only cache successful responses
  if (result.ok) {
    cache.set(key, { data: result, createdAt: Date.now(), ttlMs });
  }

  return result;
}

/**
 * Invalidate cache entries matching a pattern.
 *
 * @param pattern - String to match against cache keys. Matches any key containing this string.
 *
 * @example
 * invalidateCache('/condutor');     // Invalidates driver cache
 * invalidateCache('/empresa');      // Invalidates company cache
 * invalidateCache('/solicitacao');   // Invalidates rides cache
 * invalidateCache('');              // Invalidates ALL cache
 */
export function invalidateCache(pattern: string): void {
  let removed = 0;
  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      cache.delete(key);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`[MachineCache] Invalidated ${removed} entries matching "${pattern}"`);
  }
}

/**
 * Get cache stats for debugging.
 */
export function getCacheStats(): { size: number; keys: string[]; entries: { key: string; age: number; ttl: number; fresh: boolean }[] } {
  const entries = Array.from(cache.entries()).map(([key, entry]) => ({
    key,
    age: Math.round((Date.now() - entry.createdAt) / 1000),
    ttl: Math.round(entry.ttlMs / 1000),
    fresh: isFresh(entry),
  }));

  return { size: cache.size, keys: Array.from(cache.keys()), entries };
}

// ─── TTL Presets ─────────────────────────────────────────────────

/** Pre-defined TTLs in milliseconds */
export const CACHE_TTL = {
  /** Drivers: 10 minutes — list rarely changes */
  DRIVERS: 10 * 60 * 1000,

  /** Companies: 10 minutes — list rarely changes */
  COMPANIES: 10 * 60 * 1000,

  /** Rides listing: 15 seconds — must be fresh for real-time dashboard updates */
  RIDES: 15 * 1000,

  /** Credit balance: 24 hours (D-1) — updated once per day */
  BALANCE: 24 * 60 * 60 * 1000,

  /** Scheduled rides: 1 minute */
  SCHEDULED: 1 * 60 * 1000,

  /** Company balance: 10 minutes */
  COMPANY_BALANCE: 10 * 60 * 1000,
} as const;
