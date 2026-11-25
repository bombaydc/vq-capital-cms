'use strict';

/**
 * Store_Backend_Selector — reads store.redis.enabled at Strapi bootstrap and
 * initialises either the Redis store or the in-memory store accordingly.
 *
 * Selection logic (Design §5.1, Req 12.1–12.6):
 *   if (!config.store.redis.enabled) → MemoryStore, log info
 *   else:
 *     try connect Redis
 *       success → RedisStore, log info
 *       failure → log error + MemoryStore (no halt), log info fallback active
 *
 * Mid-operation fallback (Design §5.1, Req 12.7, 12.10–12.12):
 *   RedisStore operation fails →
 *     log warn "Store backend changed to memory (Redis error)"
 *     switch activeStore = MemoryStore
 *     start exponential backoff reconnect loop
 *       on success → switch activeStore = RedisStore, log info
 *       on exhausted → log critical, stay on MemoryStore
 *
 * References: Req 12.1–12.12, Design §5.1, Design §8.6
 */

const MemoryStore    = require('./memory-store');
const RedisStore     = require('./redis-store');
const DatabaseStore  = require('./database-store');
const HybridStore    = require('./hybrid-store');

/** @type {object|null} — the proxy-wrapped active store returned by getStore() */
let activeStore = null;

/**
 * Tracks the underlying (unwrapped) store instance for each proxy.
 * Used to determine whether the current backend is Redis or Memory.
 * @type {WeakMap<object, object>}
 */
const proxyTargetMap = new WeakMap();

/** @type {object|null} — resolved plugin config, set during init() */
let _config = null;

/** @type {object|null} — Strapi instance, set during init() */
let _strapi = null;

/** @type {RedisStore|null} — kept so we can disconnect on destroy() */
let _redisStore = null;

/** @type {ReturnType<typeof setTimeout>|null} — pending reconnect timer */
let _reconnectTimer = null;

/** @type {ReturnType<typeof setInterval>|null} — periodic purge timer for DatabaseStore */
let _purgeTimer = null;

/** @type {boolean} — true while a reconnect loop is running */
let _reconnecting = false;

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

/**
 * Emit a log message via strapi.log if available, otherwise console.
 * @param {'info'|'warn'|'error'|'debug'} level
 * @param {string} message
 */
function _log(level, message) {
  const logger = _strapi && _strapi.log;
  const tag = '[erp-session-manager] Store:';
  if (logger && typeof logger[level] === 'function') {
    logger[level](`${tag} ${message}`);
  } else {
    // eslint-disable-next-line no-console
    const consoleFn = level === 'debug' ? 'log' : level;
    // eslint-disable-next-line no-console
    (console[consoleFn] || console.log)(`${tag} ${message}`);
  }
}

/**
 * Emit a critical-level log. Strapi does not expose strapi.log.critical,
 * so we fall back to strapi.log.error with a [CRITICAL] prefix.
 * @param {string} message
 */
function _logCritical(message) {
  const tag = '[erp-session-manager] Store: [CRITICAL]';
  const logger = _strapi && _strapi.log;
  if (logger && typeof logger.error === 'function') {
    logger.error(`${tag} ${message}`);
  } else {
    // eslint-disable-next-line no-console
    console.error(`${tag} ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Proxy factory — wraps store methods to catch mid-operation Redis errors
// ---------------------------------------------------------------------------

/**
 * Create a fault-tolerant Proxy around a store instance.
 * When a Redis error is thrown by any method, the proxy:
 *   1. Switches activeStore to a new MemoryStore
 *   2. Logs warn (Req 12.7)
 *   3. Starts the exponential backoff reconnect loop (Req 12.10)
 *   4. Retries the failed operation against the new MemoryStore
 *
 * @param {object} store — the underlying store instance to wrap
 * @returns {Proxy}
 */
function _createFaultTolerantProxy(store) {
  const proxy = new Proxy(store, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function') return value;

      return function proxiedMethod(...args) {
        let result;
        try {
          result = value.apply(target, args);
        } catch (err) {
          return _handleStoreError(err, prop, args);
        }

        // Handle async (Promise) results from RedisStore
        if (result && typeof result.then === 'function') {
          return result.catch((err) => _handleStoreError(err, prop, args));
        }

        return result;
      };
    },
  });

  // Register the underlying store so we can check its type later
  proxyTargetMap.set(proxy, store);
  return proxy;
}

/**
 * Returns true if the current activeStore is backed by a RedisStore instance.
 * @returns {boolean}
 */
function _activeStoreIsRedis() {
  if (!activeStore) return false;
  const underlying = proxyTargetMap.get(activeStore);
  return underlying instanceof RedisStore;
}

/**
 * Called when a store operation throws or rejects.
 * Switches to MemoryStore, logs warn, starts reconnect loop, retries op.
 *
 * @param {Error} err
 * @param {string} methodName
 * @param {any[]} args
 * @returns {any} result of retrying the operation on MemoryStore
 */
function _handleStoreError(err, methodName, args) {
  // Only trigger Redis fallback if we were actually on Redis
  if (!_activeStoreIsRedis()) {
    throw err;
  }

  // Req 12.7 — warn that backend is changing
  _log(
    'warn',
    `Store backend changed to memory (Redis error on "${methodName}": ${err.message}). ` +
      'Session data stored in Redis is not accessible until the connection is restored.'
  );

  // Switch to MemoryStore
  const memStore = new MemoryStore();
  activeStore = _createFaultTolerantProxy(memStore);

  // Start reconnect loop (idempotent — won't start a second loop if one is running)
  if (!_reconnecting) {
    _startReconnectLoop();
  }

  // Retry the failed operation on the new MemoryStore
  const retryFn = memStore[methodName];
  if (typeof retryFn === 'function') {
    return retryFn.apply(memStore, args);
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Exponential backoff reconnect loop (Req 12.10–12.12)
// ---------------------------------------------------------------------------

/**
 * Start the exponential backoff reconnect loop.
 * Initial delay: 100 ms, doubles each attempt, capped at 30 000 ms.
 * Max attempts: config.store.redis.maxRetries (default 10).
 */
function _startReconnectLoop() {
  if (_reconnecting) return;
  _reconnecting = true;

  const maxRetries =
    _config &&
    _config.store &&
    _config.store.redis &&
    typeof _config.store.redis.maxRetries === 'number'
      ? _config.store.redis.maxRetries
      : 10;

  let attempt = 0;
  let delay = 100; // ms — initial backoff delay

  function scheduleNext() {
    _reconnectTimer = setTimeout(async () => {
      attempt++;
      const nextDelay = Math.min(delay * 2, 30000);
      _log(
        'warn',
        `Redis reconnect attempt ${attempt}/${maxRetries} (next delay if needed: ${nextDelay} ms)`
      );

      try {
        // Create a fresh RedisStore and attempt connection
        const redisConfig = (_config && _config.store && _config.store.redis) || {};
        const freshRedis = new RedisStore(redisConfig, _strapi);
        await freshRedis.connect();

        // Req 12.11 — success: switch activeStore back to Redis
        _redisStore = freshRedis;
        activeStore = _createFaultTolerantProxy(freshRedis);
        _log('info', 'Redis store reconnected. Resuming Redis-backed session storage.');
        _reconnecting = false;
        _reconnectTimer = null;
      } catch (err) {
        if (attempt >= maxRetries) {
          // Req 12.12 — exhausted: log critical, stay on MemoryStore
          _logCritical(
            `Redis reconnection exhausted after ${maxRetries} attempts. ` +
              `Staying on in-memory fallback. Last error: ${err.message}`
          );
          _reconnecting = false;
          _reconnectTimer = null;
        } else {
          // Schedule next attempt with doubled delay
          delay = nextDelay;
          scheduleNext();
        }
      }
    }, delay);

    // Allow Node.js to exit even if this timer is pending
    if (_reconnectTimer && _reconnectTimer.unref) {
      _reconnectTimer.unref();
    }
  }

  scheduleNext();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

module.exports = {
  /**
   * init(config, strapi)
   * Called from bootstrap(). Selects and initialises the appropriate store.
   *
   * @param {object} config — resolved plugin config
   * @param {object} strapi — Strapi instance
   * @returns {Promise<void>}
   */
  async init(config, strapi) {
    _config = config;
    _strapi = strapi;

    const dbEnabled =
      config &&
      config.store &&
      config.store.database &&
      config.store.database.enabled === true;

    const redisEnabled =
      config &&
      config.store &&
      config.store.redis &&
      config.store.redis.enabled === true;

    // ── 1. Hybrid backend (memory-speed reads + DB write-through + crash recovery)
    if (dbEnabled) {
      const hybridStore = new HybridStore(strapi);
      try {
        await hybridStore.connect();
        activeStore = _createFaultTolerantProxy(hybridStore);
        _log('info', 'Hybrid store is active (memory reads + MariaDB write-through, crash-safe)');

        // Schedule periodic purge of expired rows from the DB
        const purgeIntervalMs =
          (config.store.database && config.store.database.purgeIntervalMs) ||
          3600000; // default: 1 hour

        _purgeTimer = setInterval(async () => {
          try {
            const deleted = await hybridStore.purgeExpired();
            if (deleted > 0) {
              _log('debug', `Hybrid store: purged ${deleted} expired session row(s) from DB`);
            }
          } catch (err) {
            _log('warn', `Hybrid store DB purge error: ${err.message}`);
          }
        }, purgeIntervalMs);

        if (_purgeTimer && _purgeTimer.unref) _purgeTimer.unref();
        return;
      } catch (err) {
        _log('error', `Hybrid store init failed at bootstrap: ${err.message}`);
        _log('info', 'Falling back to in-memory store');
        const memStore = new MemoryStore();
        activeStore = _createFaultTolerantProxy(memStore);
        _log('info', 'in-memory store is active (Hybrid fallback)');
        return;
      }
    }

    // ── 2. Redis backend ─────────────────────────────────────────────────────
    if (!redisEnabled) {
      // Req 12.2, 12.3 — use memory store, never attempt Redis
      const memStore = new MemoryStore();
      activeStore = _createFaultTolerantProxy(memStore);
      _log('info', 'in-memory store is active');
      return;
    }

    // Req 12.4 — attempt Redis connection
    const redisConfig = (config.store && config.store.redis) || {};
    const redisStore = new RedisStore(redisConfig, strapi);

    try {
      await redisStore.connect();
      // Req 12.5 — connection succeeded
      _redisStore = redisStore;
      activeStore = _createFaultTolerantProxy(redisStore);
      _log('info', 'Redis store is active');
    } catch (err) {
      // Req 12.6 — connection failed: log error, fall back to memory, do NOT halt
      _log('error', `Redis connection failed at bootstrap: ${err.message}`);
      const memStore = new MemoryStore();
      activeStore = _createFaultTolerantProxy(memStore);
      _log('info', 'in-memory store is active (Redis fallback)');
    }
  },

  /**
   * getStore()
   * Returns the currently active ISessionStore instance (wrapped in proxy).
   * @returns {import('./interface')}
   */
  getStore() {
    if (!activeStore) {
      throw new Error('Session store has not been initialised. Call init() first.');
    }
    return activeStore;
  },

  /**
   * destroy()
   * Closes the Redis connection and clears reconnect timers.
   * @returns {Promise<void>}
   */
  async destroy() {
    // Clear any pending reconnect timer
    if (_reconnectTimer) {
      clearTimeout(_reconnectTimer);
      _reconnectTimer = null;
    }
    _reconnecting = false;

    // Clear database purge timer
    if (_purgeTimer) {
      clearInterval(_purgeTimer);
      _purgeTimer = null;
    }

    // Disconnect Redis if it was ever connected
    if (_redisStore) {
      try {
        await _redisStore.disconnect();
      } catch (err) {
        _log('warn', `Error disconnecting Redis during destroy: ${err.message}`);
      }
      _redisStore = null;
    }

    activeStore = null;
    _config = null;
    _strapi = null;
  },

  // Expose classes for testing
  MemoryStore,
  RedisStore,
  DatabaseStore,
  HybridStore,
};
