'use strict';

const ISessionStore = require('./interface');
const MemoryStore   = require('./memory-store');
const DatabaseStore = require('./database-store');

/**
 * HybridStore — memory-speed reads with database-backed crash recovery.
 *
 * Strategy
 * ────────
 * • Reads  → always served from MemoryStore (microsecond O(1) Map lookups).
 * • Writes → written to MemoryStore immediately, then persisted to DatabaseStore
 *             (write-through).  A node crash between the two writes loses at most
 *             one in-flight session — acceptable for this threat model.
 * • Restart warm-up → on connect(), all non-expired sessions are loaded from the
 *             DB back into MemoryStore, so sessions survive node crashes/restarts.
 * • updateLastActive debounce → called on every authenticated request; DB writes
 *             are batched and flushed every LAST_ACTIVE_FLUSH_MS to avoid hammering
 *             the DB with per-request updates while keeping crash recovery accurate
 *             to within that window.
 * • Purge    → DatabaseStore.purgeExpired() is called periodically by index.js;
 *             MemoryStore handles its own TTL timers.
 *
 * When to use
 * ───────────
 * Single-node deployments where you want crash recovery without the operational
 * overhead of Redis.  For multi-node (horizontal scale), use RedisStore instead
 * so all nodes share one session state.
 */

/** How often to flush debounced lastActive timestamps to the DB (ms). */
const LAST_ACTIVE_FLUSH_MS = 10_000; // 10 seconds

class HybridStore extends ISessionStore {
  /**
   * @param {object} strapi — Strapi instance
   */
  constructor(strapi) {
    super();
    this._strapi = strapi;
    this._mem = new MemoryStore();
    this._db  = new DatabaseStore(strapi);

    /** Identifies this backend to the status controller. */
    this._backendType = 'hybrid';

    /**
     * Debounce buffer for lastActive DB writes.
     * sessionId → latest timestamp (overwrites earlier pending value).
     * @type {Map<string, number>}
     */
    this._pendingLastActive = new Map();

    /** @type {ReturnType<typeof setTimeout>|null} */
    this._lastActiveFlushTimer = null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialise the DB (create table if needed) then warm up MemoryStore from DB.
   * Called by Store_Backend_Selector.init() during Strapi bootstrap.
   */
  async connect() {
    await this._db.connect();
    await this._warmUp();
  }

  /**
   * Load all non-expired, non-revoked sessions from DB into MemoryStore.
   * Runs once at bootstrap; completes before the first request is served.
   */
  async _warmUp() {
    const now      = Date.now();
    let page       = 1;
    const pageSize = 500;
    let loaded     = 0;

    // Iterate pages to avoid loading millions of rows into one array
    while (true) {
      const { records, total } = await this._db.listAll({ page, pageSize });

      for (const record of records) {
        // Only warm active sessions into memory
        if (!record.isRevoked && record.expiresAt > now) {
          const ttlMs = record.expiresAt - now;
          this._mem.set(record.sessionId, record, ttlMs);
          loaded++;
        }
      }

      if (page * pageSize >= total) break;
      page++;
    }

    if (this._strapi && this._strapi.log) {
      this._strapi.log.info(
        `[erp-session-manager] Hybrid store warm-up complete: ${loaded} active session(s) loaded from MariaDB into memory`
      );
    }

    return loaded;
  }

  /**
   * Flush all pending lastActive timestamps to the DB and clear the timer.
   * Safe to call multiple times; no-op if nothing is pending.
   */
  async _flushLastActive() {
    this._lastActiveFlushTimer = null;
    if (this._pendingLastActive.size === 0) return;

    const pending = new Map(this._pendingLastActive);
    this._pendingLastActive.clear();

    // Fire all DB updates concurrently
    await Promise.all(
      Array.from(pending.entries()).map(([sessionId, ts]) =>
        this._db.updateLastActive(sessionId, ts).catch(() => {
          // Best-effort — a missed lastActive flush is non-critical
        })
      )
    );
  }

  /**
   * Purge expired rows from the database.
   * Called by the periodic timer in store/index.js.
   * @returns {Promise<number>}
   */
  async purgeExpired() {
    return this._db.purgeExpired();
  }

  // ---------------------------------------------------------------------------
  // ISessionStore implementation
  // ---------------------------------------------------------------------------

  /**
   * Fast memory read — O(1).
   * @param {string} sessionId
   * @returns {Promise<object|null>}
   */
  async get(sessionId) {
    return this._mem.get(sessionId);
  }

  /**
   * Write-through: memory first, then DB.
   * @param {string} sessionId
   * @param {object} record
   * @param {number} [ttlMs]
   * @returns {Promise<void>}
   */
  async set(sessionId, record, ttlMs) {
    this._mem.set(sessionId, record, ttlMs);
    await this._db.set(sessionId, record, ttlMs);
  }

  /**
   * Delete from both stores.
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async delete(sessionId) {
    this._mem.delete(sessionId);
    await this._db.delete(sessionId);
  }

  /**
   * Fast memory read by user — no DB hit needed.
   * @param {number} userId
   * @returns {Promise<object[]>}
   */
  async getByUser(userId) {
    return this._mem.getByUser(userId);
  }

  /**
   * Delete from both stores.
   * @param {number} userId
   * @returns {Promise<number>}
   */
  async deleteByUser(userId) {
    const count = this._mem.deleteByUser(userId);
    await this._db.deleteByUser(userId);
    return count;
  }

  /**
   * Delete batch from both stores.
   * @param {string[]} sessionIds
   * @returns {Promise<number>}
   */
  async deleteMany(sessionIds) {
    const count = this._mem.deleteMany(sessionIds);
    await this._db.deleteMany(sessionIds);
    return count;
  }

  /**
   * Fast paginated list from memory.
   * @param {object} [filters]
   * @returns {Promise<{ records: object[], total: number }>}
   */
  async listAll(filters) {
    return this._mem.listAll(filters);
  }

  /**
   * Update lastActive in memory immediately; debounce the DB write to
   * LAST_ACTIVE_FLUSH_MS to avoid a DB round-trip on every authenticated request.
   *
   * @param {string} sessionId
   * @param {number} timestamp
   * @returns {Promise<void>}
   */
  async updateLastActive(sessionId, timestamp) {
    // Immediate memory update (keeps idle-timeout logic accurate)
    this._mem.updateLastActive(sessionId, timestamp);

    // Buffer DB write; overwrite any earlier pending value for this session
    this._pendingLastActive.set(sessionId, timestamp);

    if (!this._lastActiveFlushTimer) {
      this._lastActiveFlushTimer = setTimeout(
        () => this._flushLastActive(),
        LAST_ACTIVE_FLUSH_MS
      );
      if (this._lastActiveFlushTimer.unref) {
        this._lastActiveFlushTimer.unref();
      }
    }
  }

  /**
   * Revoke in both stores.
   * Must complete within 100 ms (Req 2.5) — both operations are fast:
   *   memory: Map mutation (µs); DB: indexed UPDATE by PK (low ms).
   *
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  /**
   * VAPT #10 Gap 4: Accept and propagate revocation metadata options to both
   * the in-memory store (for audit fields on the live record) and the DB
   * store (for persisted reason/revokedBy/revokedAt columns).
   *
   * @param {string} sessionId
   * @param {{ reason?: string, revokedBy?: number|null, revokedAt?: number }} [options]
   */
  async markRevoked(sessionId, options = {}) {
    this._mem.markRevoked(sessionId, options);
    await this._db.markRevoked(sessionId, options);
  }
}

module.exports = HybridStore;
