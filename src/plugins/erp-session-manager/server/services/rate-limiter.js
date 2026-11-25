'use strict';

/**
 * RateLimiter — tracks and throttles repeated authentication attempts.
 *
 * Counter key pattern: erp:rl:{endpoint}:{identifier}
 * identifier = IP address (IP-based) or userId (user-based)
 *
 * Backends (Design §5.7):
 *   Memory — Map<key, { count, resetAt }>
 *   Redis  — INCR + EXPIRE commands (atomic)
 *
 * Follows the same store selection as Session_Store (Req 11.6, Req 12.16).
 *
 * References: Req 11.1–11.6, Design §5.7
 */

const storeModule = require('./store');

/** In-memory fallback counters: Map<key, { count, resetAt }> */
const _memCounters = new Map();

/**
 * Build the counter key.
 * @param {string} endpoint
 * @param {string} identifier
 * @returns {string}
 */
function counterKey(endpoint, identifier) {
  return `erp:rl:${endpoint}:${identifier}`;
}

/**
 * Get the Redis client from the active store if it is a RedisStore.
 * Returns null if the active store is MemoryStore or Redis is unavailable.
 * @returns {import('ioredis').Redis | null}
 */
function _getRedisClient() {
  try {
    const store = storeModule.getStore();
    // Access the underlying store through the proxy's target map
    // The RedisStore exposes _client; MemoryStore does not.
    const underlying = store._client !== undefined ? store : null;
    return underlying && underlying._client ? underlying._client : null;
  } catch {
    return null;
  }
}

module.exports = ({ strapi: _strapi }) => ({
  /**
   * check(endpoint, identifier, limitConfig)
   * Returns the current rate limit status without incrementing.
   *
   * @param {string} endpoint    — e.g. 'login', 'register', 'refresh'
   * @param {string} identifier  — IP address or userId string
   * @param {{ windowMs: number, maxAttempts: number }} limitConfig
   * @returns {{ allowed: boolean, remaining: number, resetAt: number }}
   */
  check(endpoint, identifier, limitConfig) {
    const { maxAttempts } = limitConfig;
    const key = counterKey(endpoint, identifier);
    const now = Date.now();

    const entry = _memCounters.get(key);
    if (!entry || entry.resetAt <= now) {
      return { allowed: true, remaining: maxAttempts, resetAt: now + limitConfig.windowMs };
    }

    const remaining = Math.max(0, maxAttempts - entry.count);
    return {
      allowed: entry.count < maxAttempts,
      remaining,
      resetAt: entry.resetAt,
    };
  },

  /**
   * increment(endpoint, identifier, limitConfig)
   * Increments the attempt counter. Uses Redis when available, memory otherwise.
   *
   * @param {string} endpoint
   * @param {string} identifier
   * @param {{ windowMs: number, maxAttempts: number }} limitConfig
   * @returns {Promise<{ allowed: boolean, remaining: number, resetAt: number }>}
   */
  async increment(endpoint, identifier, limitConfig) {
    const { windowMs, maxAttempts } = limitConfig;
    const key = counterKey(endpoint, identifier);
    const now = Date.now();

    // Try Redis first (Req 11.6, Req 12.16)
    const redisClient = _getRedisClient();
    if (redisClient) {
      try {
        const ttlSeconds = Math.ceil(windowMs / 1000);
        // INCR is atomic; EXPIRE only sets TTL on first increment
        const count = await redisClient.incr(key);
        if (count === 1) {
          await redisClient.expire(key, ttlSeconds);
        }
        const ttl = await redisClient.ttl(key);
        const resetAt = now + (ttl > 0 ? ttl * 1000 : windowMs);
        const remaining = Math.max(0, maxAttempts - count);
        return { allowed: count <= maxAttempts, remaining, resetAt };
      } catch {
        // Fall through to memory backend on Redis error
      }
    }

    // Memory backend
    let entry = _memCounters.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
    }
    entry.count += 1;
    _memCounters.set(key, entry);

    // Schedule cleanup to avoid memory leak
    const delay = entry.resetAt - now;
    setTimeout(() => {
      const current = _memCounters.get(key);
      if (current && current.resetAt <= Date.now()) {
        _memCounters.delete(key);
      }
    }, delay).unref();

    const remaining = Math.max(0, maxAttempts - entry.count);
    return {
      allowed: entry.count <= maxAttempts,
      remaining,
      resetAt: entry.resetAt,
    };
  },

  /**
   * reset(endpoint, identifier)
   * Clears the counter for a given endpoint+identifier (e.g. on successful login).
   * @param {string} endpoint
   * @param {string} identifier
   * @returns {Promise<void>}
   */
  async reset(endpoint, identifier) {
    const key = counterKey(endpoint, identifier);
    _memCounters.delete(key);

    const redisClient = _getRedisClient();
    if (redisClient) {
      try {
        await redisClient.del(key);
      } catch {
        // best-effort
      }
    }
  },
});
