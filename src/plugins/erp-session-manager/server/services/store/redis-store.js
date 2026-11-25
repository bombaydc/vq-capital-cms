'use strict';
const { optionalRequire } = require('../../../../../utils/optional-deps'); // on-demand SDKs — see src/utils/optional-deps.js

const ISessionStore = require('./interface');

/** Expiring-soon threshold in milliseconds (30 minutes). */
const EXPIRING_SOON_MS = 30 * 60 * 1000;

/** Redis key prefixes. */
const SESSION_KEY_PREFIX = 'erp:session:';
const USER_INDEX_PREFIX = 'erp:user-sessions:';

/**
 * Build the Redis key for a session record.
 * @param {string} sessionId
 * @returns {string}
 */
function sessionKey(sessionId) {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

/**
 * Build the Redis key for a user's session index set.
 * @param {number|string} userId
 * @returns {string}
 */
function userIndexKey(userId) {
  return `${USER_INDEX_PREFIX}${userId}`;
}

/**
 * Serialize a Session_Record to a plain string for storage.
 * We store the entire record as a single JSON string under a Redis String key.
 * This keeps serialisation/deserialisation simple and avoids the type-coercion
 * issues that arise when storing nested objects (e.g. geoLocation, anomalyFlags)
 * as individual Redis Hash fields.
 *
 * @param {object} record
 * @returns {string}
 */
function serialize(record) {
  return JSON.stringify(record);
}

/**
 * Deserialize a Session_Record from its stored JSON string.
 * Returns null if the value is falsy (key expired / not found).
 *
 * @param {string|null} value
 * @returns {object|null}
 */
function deserialize(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * RedisStore — Redis-backed ISessionStore implementation using ioredis.
 *
 * Storage layout:
 *   erp:session:{sessionId}        → Redis String (JSON-serialised Session_Record)
 *   erp:user-sessions:{userId}     → Redis Set of sessionIds
 *
 * Each session key has a TTL equal to tokens.refreshTokenTtl so that
 * expired records are automatically purged by Redis without a separate
 * cleanup job (Req 12.15).
 *
 * Supports Sentinel topology via store.redis.sentinels (Req 12.13).
 * Supports Cluster topology via store.redis.cluster (Req 12.14).
 *
 * All methods are async — Redis operations are inherently I/O-bound.
 */
class RedisStore extends ISessionStore {
  /**
   * @param {object} redisConfig  — resolved store.redis config section
   * @param {object} strapi       — Strapi instance (used for logging)
   */
  constructor(redisConfig, strapi) {
    super();
    this._redisConfig = redisConfig || {};
    this._strapi = strapi;
    this._client = null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Establish the Redis connection.
   * Creates the appropriate ioredis client based on the topology:
   *   - Cluster  : when store.redis.cluster array is provided (Req 12.14)
   *   - Sentinel : when store.redis.sentinels array is provided (Req 12.13)
   *   - Standard : otherwise
   *
   * @returns {Promise<void>}
   */
  async connect() {
    // Lazy-require ioredis so the plugin can still load even if ioredis is not
    // installed (the Store_Backend_Selector will catch the error and fall back).
    const ioredis = optionalRequire('ioredis');
    const cfg = this._redisConfig;

    const sharedOptions = {
      password: cfg.password,
      db: cfg.db !== undefined ? cfg.db : 0,
      // Disable ioredis's built-in auto-reconnect — the Store_Backend_Selector
      // owns the reconnect loop (Req 12.10).
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    };

    if (Array.isArray(cfg.cluster) && cfg.cluster.length > 0) {
      // Redis Cluster topology (Req 12.14)
      this._client = new ioredis.Cluster(cfg.cluster, {
        redisOptions: sharedOptions,
      });
    } else if (Array.isArray(cfg.sentinels) && cfg.sentinels.length > 0) {
      // Redis Sentinel topology (Req 12.13)
      this._client = new ioredis({
        sentinels: cfg.sentinels,
        name: cfg.sentinelName || 'mymaster',
        ...sharedOptions,
      });
    } else {
      // Standard single-node / URL connection
      if (cfg.url) {
        this._client = new ioredis(cfg.url, sharedOptions);
      } else {
        this._client = new ioredis({
          host: cfg.host || '127.0.0.1',
          port: cfg.port || 6379,
          ...sharedOptions,
        });
      }
    }

    // Explicitly connect (lazyConnect: true means it won't auto-connect).
    await this._client.connect();

    this._log('info', 'RedisStore connected');
  }

  /**
   * Close the Redis connection gracefully.
   *
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this._client) {
      await this._client.quit();
      this._client = null;
      this._log('info', 'RedisStore disconnected');
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Emit a log message via strapi.log if available, otherwise console.
   * @param {'info'|'warn'|'error'|'debug'} level
   * @param {string} message
   */
  _log(level, message) {
    const logger = this._strapi && this._strapi.log;
    if (logger && typeof logger[level] === 'function') {
      logger[level](`[erp-session-manager] RedisStore: ${message}`);
    } else {
      // eslint-disable-next-line no-console
      console[level === 'debug' ? 'log' : level](
        `[erp-session-manager] RedisStore: ${message}`
      );
    }
  }

  /**
   * Compute the TTL in seconds for a session key.
   * Falls back to 8 hours (28800 s) if config is unavailable.
   *
   * @param {number} [ttlMs] — explicit TTL in milliseconds (from set() caller)
   * @returns {number} TTL in whole seconds (minimum 1)
   */
  _ttlSeconds(ttlMs) {
    if (typeof ttlMs === 'number' && ttlMs > 0) {
      return Math.max(1, Math.ceil(ttlMs / 1000));
    }
    // Fall back to tokens.refreshTokenTtl from config (Req 12.15).
    const refreshTokenTtl =
      this._redisConfig &&
      this._redisConfig._parentConfig &&
      this._redisConfig._parentConfig.tokens &&
      this._redisConfig._parentConfig.tokens.refreshTokenTtl;
    if (typeof refreshTokenTtl === 'number' && refreshTokenTtl > 0) {
      return refreshTokenTtl;
    }
    return 28800; // 8 hours default
  }

  // ---------------------------------------------------------------------------
  // ISessionStore implementation
  // ---------------------------------------------------------------------------

  /**
   * Retrieve a single Session_Record by its ID.
   *
   * @param {string} sessionId
   * @returns {Promise<object|null>}
   */
  async get(sessionId) {
    const value = await this._client.get(sessionKey(sessionId));
    return deserialize(value);
  }

  /**
   * Persist a Session_Record with an optional TTL.
   * Sets the session key with EX (seconds) TTL and adds the sessionId to the
   * user's index set (Req 12.15).
   *
   * @param {string} sessionId
   * @param {object} record
   * @param {number} [ttlMs] — time-to-live in milliseconds
   * @returns {Promise<void>}
   */
  async set(sessionId, record, ttlMs) {
    const ttl = this._ttlSeconds(ttlMs);
    const key = sessionKey(sessionId);
    const value = serialize(record);

    // Use a pipeline for atomicity and efficiency.
    const pipeline = this._client.pipeline();
    pipeline.set(key, value, 'EX', ttl);
    pipeline.sadd(userIndexKey(record.userId), sessionId);
    await pipeline.exec();
  }

  /**
   * Remove a Session_Record and clean up the user index.
   *
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async delete(sessionId) {
    // Fetch the record first so we know which user index to clean up.
    const record = await this.get(sessionId);
    if (!record) return;

    const pipeline = this._client.pipeline();
    pipeline.del(sessionKey(sessionId));
    pipeline.srem(userIndexKey(record.userId), sessionId);
    await pipeline.exec();
  }

  /**
   * Retrieve all Session_Records for a given user.
   *
   * @param {number} userId
   * @returns {Promise<object[]>}
   */
  async getByUser(userId) {
    const sessionIds = await this._client.smembers(userIndexKey(userId));
    if (!sessionIds || sessionIds.length === 0) return [];

    // Fetch all records in a single pipeline.
    const pipeline = this._client.pipeline();
    for (const id of sessionIds) {
      pipeline.get(sessionKey(id));
    }
    const results = await pipeline.exec();

    const records = [];
    const staleIds = [];

    for (let i = 0; i < results.length; i++) {
      const [err, value] = results[i];
      if (err) continue;
      const record = deserialize(value);
      if (record) {
        records.push(record);
      } else {
        // Key has expired in Redis but is still in the user index — clean up.
        staleIds.push(sessionIds[i]);
      }
    }

    // Remove stale entries from the user index asynchronously (best-effort).
    if (staleIds.length > 0) {
      this._client
        .srem(userIndexKey(userId), ...staleIds)
        .catch((err) => this._log('warn', `Failed to clean stale user index: ${err.message}`));
    }

    return records;
  }

  /**
   * Delete all Session_Records for a given user.
   *
   * @param {number} userId
   * @returns {Promise<number>} count of deleted records
   */
  async deleteByUser(userId) {
    const sessionIds = await this._client.smembers(userIndexKey(userId));
    if (!sessionIds || sessionIds.length === 0) return 0;

    const pipeline = this._client.pipeline();
    for (const id of sessionIds) {
      pipeline.del(sessionKey(id));
    }
    // Remove the entire user index set.
    pipeline.del(userIndexKey(userId));
    const results = await pipeline.exec();

    // Count successful DEL operations (each returns 1 if key existed, 0 if not).
    // The last result is the DEL of the user index set itself — exclude it.
    let count = 0;
    for (let i = 0; i < results.length - 1; i++) {
      const [err, deleted] = results[i];
      if (!err && deleted === 1) count++;
    }
    return count;
  }

  /**
   * Delete multiple Session_Records by ID.
   * Silently skips IDs that do not exist.
   *
   * @param {string[]} sessionIds
   * @returns {Promise<number>} count of actually deleted records
   */
  async deleteMany(sessionIds) {
    if (!sessionIds || sessionIds.length === 0) return 0;

    // Fetch records first to get userId for index cleanup.
    const getPipeline = this._client.pipeline();
    for (const id of sessionIds) {
      getPipeline.get(sessionKey(id));
    }
    const getResults = await getPipeline.exec();

    const delPipeline = this._client.pipeline();
    let count = 0;

    for (let i = 0; i < sessionIds.length; i++) {
      const [err, value] = getResults[i];
      if (err) continue;
      const record = deserialize(value);
      if (record) {
        delPipeline.del(sessionKey(sessionIds[i]));
        delPipeline.srem(userIndexKey(record.userId), sessionIds[i]);
        count++;
      }
    }

    if (count > 0) {
      await delPipeline.exec();
    }

    return count;
  }

  /**
   * List all Session_Records with optional filters and pagination.
   * Uses SCAN with cursor iteration to avoid blocking Redis (production-safe).
   *
   * @param {object} [filters]
   * @param {number}  [filters.userId]
   * @param {string}  [filters.ip]
   * @param {string}  [filters.status]    'active' | 'anomaly' | 'expiring'
   * @param {string}  [filters.sortBy]    'issuedAt' | 'lastActive' | 'expiresAt'
   * @param {string}  [filters.sortOrder] 'asc' | 'desc'
   * @param {number}  [filters.page]      1-based (default 1)
   * @param {number}  [filters.pageSize]  (default 25)
   * @returns {Promise<{ records: object[], total: number }>}
   */
  _filterRecords(records, { userId, ip, status }, now) {
    let result = records;
    if (userId !== undefined && userId !== null) {
      result = result.filter((r) => r.userId === userId);
    }
    if (ip) {
      result = result.filter((r) => r.ipAddress === ip);
    }
    if (status) {
      switch (status) {
        case 'active':
          result = result.filter((r) => !r.isRevoked && r.expiresAt > now);
          break;
        case 'anomaly':
          result = result.filter((r) => Array.isArray(r.anomalyFlags) && r.anomalyFlags.length > 0);
          break;
        case 'expiring':
          result = result.filter((r) => !r.isRevoked && r.expiresAt > now && r.expiresAt - now <= EXPIRING_SOON_MS);
          break;
        default:
          result = [];
      }
    }
    return result;
  }

  _sortRecords(records, sortBy, sortOrder) {
    const SORT_FIELDS = ['issuedAt', 'lastActive', 'expiresAt'];
    if (sortBy && SORT_FIELDS.includes(sortBy)) {
      const direction = sortOrder === 'asc' ? 1 : -1;
      return records.slice().sort((a, b) => {
        const av = a[sortBy] ?? 0;
        const bv = b[sortBy] ?? 0;
        return (av - bv) * direction;
      });
    }
    return records;
  }

  async listAll(filters = {}) {
    const {
      sortBy,
      sortOrder = 'desc',
      page = 1,
      pageSize = 25,
    } = filters;

    const allKeys = await this._scanAllSessionKeys();

    if (allKeys.length === 0) {
      return { records: [], total: 0 };
    }

    const pipeline = this._client.pipeline();
    for (const key of allKeys) {
      pipeline.get(key);
    }
    const results = await pipeline.exec();

    let rawRecords = [];
    for (const [err, value] of results) {
      if (err) continue;
      const record = deserialize(value);
      if (record) rawRecords.push(record);
    }

    const filteredRecords = this._filterRecords(rawRecords, filters, Date.now());
    const sortedRecords = this._sortRecords(filteredRecords, sortBy, sortOrder);

    const total = sortedRecords.length;
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.max(1, Math.floor(pageSize));
    const start = (safePage - 1) * safePageSize;
    const paginatedRecords = sortedRecords.slice(start, start + safePageSize);

    return { records: paginatedRecords, total };
  }

  /**
   * Update the lastActive timestamp on a Session_Record in-place.
   * Fetches the current record, updates the field, and re-saves with the
   * remaining TTL preserved.
   * No-op if the session does not exist.
   *
   * @param {string} sessionId
   * @param {number} timestamp — Unix timestamp in milliseconds
   * @returns {Promise<void>}
   */
  async updateLastActive(sessionId, timestamp) {
    const key = sessionKey(sessionId);

    // Get current TTL before overwriting so we don't reset it.
    const [record, ttl] = await Promise.all([
      this.get(sessionId),
      this._client.ttl(key),
    ]);

    if (!record) return;

    record.lastActive = timestamp;

    // Preserve the existing TTL (ttl returns -1 if no expiry, -2 if not found).
    if (ttl > 0) {
      await this._client.set(key, serialize(record), 'EX', ttl);
    } else {
      // No TTL was set — just update the value.
      await this._client.set(key, serialize(record));
    }
  }

  /**
   * Mark a Session_Record as revoked by setting isRevoked: true.
   * Must complete within 100 ms (Req 2.5).
   * No-op if the session does not exist.
   *
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async markRevoked(sessionId) {
    const key = sessionKey(sessionId);

    const [record, ttl] = await Promise.all([
      this.get(sessionId),
      this._client.ttl(key),
    ]);

    if (!record) return;

    record.isRevoked = true;

    if (ttl > 0) {
      await this._client.set(key, serialize(record), 'EX', ttl);
    } else {
      await this._client.set(key, serialize(record));
    }
  }

  // ---------------------------------------------------------------------------
  // Private scan helper
  // ---------------------------------------------------------------------------

  /**
   * Iterate all `erp:session:*` keys using SCAN with cursor to avoid blocking
   * Redis with a KEYS command in production (Design §5.1 note).
   *
   * For Redis Cluster clients, ioredis exposes `scanStream` on each node via
   * the cluster's `nodes()` method; for standard/Sentinel clients we use the
   * standard `scanStream`.
   *
   * @returns {Promise<string[]>} array of matching Redis keys
   */
  async _scanAllSessionKeys() {
    const pattern = `${SESSION_KEY_PREFIX}*`;
    const keys = [];

    // ioredis Cluster exposes a different scan API.
    if (this._client.constructor && this._client.constructor.name === 'Cluster') {
      // Scan each master node independently.
      const nodes = this._client.nodes('master');
      await Promise.all(
        nodes.map((node) =>
          new Promise((resolve, reject) => {
            const stream = node.scanStream({ match: pattern, count: 100 });
            stream.on('data', (batch) => keys.push(...batch));
            stream.on('end', resolve);
            stream.on('error', reject);
          })
        )
      );
    } else {
      await new Promise((resolve, reject) => {
        const stream = this._client.scanStream({ match: pattern, count: 100 });
        stream.on('data', (batch) => keys.push(...batch));
        stream.on('end', resolve);
        stream.on('error', reject);
      });
    }

    return keys;
  }
}

module.exports = RedisStore;
