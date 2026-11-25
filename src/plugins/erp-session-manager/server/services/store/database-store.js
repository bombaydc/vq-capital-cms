'use strict';

const ISessionStore = require('./interface');

/** Expiring-soon threshold in milliseconds (30 minutes). */
const EXPIRING_SOON_MS = 30 * 60 * 1000;

/** Database table name for sessions. */
const TABLE = 'erp_sessions';

/**
 * DatabaseStore — ISessionStore implementation backed by the existing Strapi
 * database (MariaDB / MySQL / SQLite via Knex).
 *
 * Sessions survive Node.js crashes because they are persisted in the same
 * MariaDB database that Strapi already uses.  No additional infrastructure is
 * required — the table is created automatically on first `connect()`.
 *
 * Knex is accessed via `strapi.db.connection` which is initialised before
 * plugin bootstrap runs.
 *
 * All methods are async (return Promises) to match the RedisStore interface
 * contract used by the fault-tolerant proxy in store/index.js.
 */
class DatabaseStore extends ISessionStore {
  /**
   * @param {object} strapi — Strapi instance
   */
  constructor(strapi) {
    super();
    this._strapi = strapi;
    /** Identifies this backend to the status controller. */
    this._backendType = 'database';
  }

  /**
   * Returns the underlying Knex instance from Strapi's DB layer.
   * @returns {import('knex').Knex}
   */
  _knex() {
    return this._strapi.db.connection;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Creates the `erp_sessions` table if it does not yet exist, then verifies
   * the connection by running a lightweight query.
   *
   * Called by Store_Backend_Selector.init() during Strapi bootstrap.
   */
  async connect() {
    const knex = this._knex();

    const hasTable = await knex.schema.hasTable(TABLE);
    if (!hasTable) {
      await knex.schema.createTable(TABLE, (t) => {
        t.string('session_id', 64).notNullable().primary();
        t.integer('user_id').notNullable().index();
        t.string('refresh_token_hash', 64).nullable();
        t.bigInteger('issued_at').notNullable();
        t.bigInteger('last_active').notNullable();
        t.bigInteger('expires_at').notNullable().index();
        t.string('ip_address', 45).nullable();
        t.text('user_agent').nullable();
        // MySQL/MariaDB stores boolean as TINYINT(1)
        t.boolean('is_revoked').notNullable().defaultTo(false).index();
        // JSON array stored as text: '[]' or '["IP_CHANGE","UA_CHANGE"]'
        t.text('anomaly_flags').nullable();
        // G13: Extended fields — device fingerprint, rotation counter, revocation metadata
        t.string('device_hash', 64).nullable();
        t.integer('rotation_count').notNullable().defaultTo(0);
        t.string('revoke_reason', 64).nullable();
        t.integer('revoked_by').nullable();
        t.bigInteger('revoked_at').nullable();
      });
    } else {
      // G13: Add new columns via conditional ALTER for existing tables
      const cols = await knex(TABLE).columnInfo();
      if (!cols.device_hash)    await knex.schema.table(TABLE, t => t.string('device_hash', 64).nullable());
      if (!cols.rotation_count) await knex.schema.table(TABLE, t => t.integer('rotation_count').notNullable().defaultTo(0));
      if (!cols.revoke_reason)  await knex.schema.table(TABLE, t => t.string('revoke_reason', 64).nullable());
      if (!cols.revoked_by)     await knex.schema.table(TABLE, t => t.integer('revoked_by').nullable());
      if (!cols.revoked_at)     await knex.schema.table(TABLE, t => t.bigInteger('revoked_at').nullable());
    }

    // Lightweight connectivity check
    await knex.raw('SELECT 1');
  }

  /**
   * Purge sessions whose `expires_at` timestamp is in the past.
   * Should be called periodically (e.g. from a cron / setInterval).
   *
   * @returns {Promise<number>} count of deleted rows
   */
  async purgeExpired() {
    return this._knex()(TABLE)
      .where('expires_at', '<', Date.now())
      .delete();
  }

  // ---------------------------------------------------------------------------
  // Row <-> Record helpers
  // ---------------------------------------------------------------------------

  /**
   * Converts a raw database row to an in-memory Session_Record object.
   * @param {object|null|undefined} row
   * @returns {object|null}
   */
  _rowToRecord(row) {
    if (!row) return null;
    return {
      sessionId:        row.session_id,
      userId:           Number(row.user_id),
      refreshTokenHash: row.refresh_token_hash || null,
      issuedAt:         Number(row.issued_at),
      lastActive:       Number(row.last_active),
      expiresAt:        Number(row.expires_at),
      ipAddress:        row.ip_address || null,
      userAgent:        row.user_agent || null,
      // MariaDB returns TINYINT as 0/1 (number), not boolean
      isRevoked:        row.is_revoked === 1 || row.is_revoked === true,
      anomalyFlags:     this._parseFlags(row.anomaly_flags),
      // G13: Extended fields
      deviceHash:    row.device_hash    || null,
      rotationCount: row.rotation_count != null ? Number(row.rotation_count) : 0,
      revokeReason:  row.revoke_reason  || null,
      revokedBy:     row.revoked_by     != null ? Number(row.revoked_by) : null,
      revokedAt:     row.revoked_at     != null ? Number(row.revoked_at) : null,
    };
  }

  /**
   * Converts a Session_Record to a flat row object suitable for Knex insert/update.
   * @param {string} sessionId
   * @param {object} record
   * @returns {object}
   */
  _recordToRow(sessionId, record) {
    return {
      session_id:         sessionId,
      user_id:            record.userId,
      refresh_token_hash: record.refreshTokenHash || null,
      issued_at:          record.issuedAt,
      last_active:        record.lastActive,
      expires_at:         record.expiresAt,
      ip_address:         record.ipAddress  || null,
      user_agent:         record.userAgent  || null,
      is_revoked:         record.isRevoked  ? 1 : 0,
      anomaly_flags:      JSON.stringify(record.anomalyFlags || []),
      // G13: Extended fields
      device_hash:    record.deviceHash   || null,
      rotation_count: record.rotationCount ?? 0,
      revoke_reason:  record.revokeReason  || null,
      revoked_by:     record.revokedBy     || null,
      revoked_at:     record.revokedAt     || null,
    };
  }

  /**
   * Safely parse the anomaly_flags JSON column.
   * @param {string|null|undefined} raw
   * @returns {string[]}
   */
  _parseFlags(raw) {
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }

  // ---------------------------------------------------------------------------
  // ISessionStore implementation
  // ---------------------------------------------------------------------------

  /**
   * Retrieve a single Session_Record by ID.
   * @param {string} sessionId
   * @returns {Promise<object|null>}
   */
  async get(sessionId) {
    const row = await this._knex()(TABLE)
      .where({ session_id: sessionId })
      .first();
    return this._rowToRecord(row);
  }

  /**
   * Persist a Session_Record.
   * The `expiresAt` field in the record drives database-level expiry via
   * `purgeExpired()`; the `ttlMs` parameter is accepted for interface
   * compatibility but ignored (TTL is computed from `record.expiresAt`).
   *
   * @param {string} sessionId
   * @param {object} record
   * @param {number} [ttlMs] — ignored; kept for interface compatibility
   * @returns {Promise<void>}
   */
  async set(sessionId, record, _ttlMs) {
    const row = this._recordToRow(sessionId, record);
    const existing = await this._knex()(TABLE)
      .where({ session_id: sessionId })
      .first();

    if (existing) {
      await this._knex()(TABLE)
        .where({ session_id: sessionId })
        .update(row);
    } else {
      await this._knex()(TABLE).insert(row);
    }
  }

  /**
   * Remove a session by ID.
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async delete(sessionId) {
    await this._knex()(TABLE)
      .where({ session_id: sessionId })
      .delete();
  }

  /**
   * Retrieve all sessions for a given user.
   * @param {number} userId
   * @returns {Promise<object[]>}
   */
  async getByUser(userId) {
    const rows = await this._knex()(TABLE)
      .where({ user_id: userId });
    return rows.map((r) => this._rowToRecord(r));
  }

  /**
   * Delete all sessions for a given user.
   * @param {number} userId
   * @returns {Promise<number>} count deleted
   */
  async deleteByUser(userId) {
    return this._knex()(TABLE)
      .where({ user_id: userId })
      .delete();
  }

  /**
   * Delete a batch of sessions by ID.
   * @param {string[]} sessionIds
   * @returns {Promise<number>} count deleted
   */
  async deleteMany(sessionIds) {
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) return 0;
    return this._knex()(TABLE)
      .whereIn('session_id', sessionIds)
      .delete();
  }

  /**
   * List sessions with optional filters and pagination.
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
  async listAll(filters = {}) {
    const {
      userId,
      ip,
      status,
      sortBy,
      sortOrder = 'desc',
      page      = 1,
      pageSize  = 25,
    } = filters;

    const now = Date.now();

    /**
     * Apply shared WHERE clauses to a Knex query builder.
     * @param {import('knex').Knex.QueryBuilder} q
     * @returns {import('knex').Knex.QueryBuilder}
     */
    const applyFilters = (q) => {
      if (userId !== undefined && userId !== null) {
        q = q.where({ user_id: userId });
      }
      if (ip) {
        q = q.where({ ip_address: ip });
      }
      if (status === 'active') {
        q = q.where({ is_revoked: 0 }).where('expires_at', '>', now);
      } else if (status === 'anomaly') {
        // Non-empty JSON array: length > 2 (i.e. more than just "[]")
        q = q
          .whereNotNull('anomaly_flags')
          .whereNot({ anomaly_flags: '[]' })
          .where('anomaly_flags', '!=', '');
      } else if (status === 'expiring') {
        q = q
          .where({ is_revoked: 0 })
          .where('expires_at', '>', now)
          .where('expires_at', '<=', now + EXPIRING_SOON_MS);
      } else if (status === 'revoked-only') {
        // G9/G10: Used by token-revocation service at bootstrap to pre-load hashes
        q = q.where({ is_revoked: 1 });
      }
      return q;
    };

    // Column name map
    const SORT_COL = {
      issuedAt:   'issued_at',
      lastActive: 'last_active',
      expiresAt:  'expires_at',
    };
    const sortCol = SORT_COL[sortBy] || 'issued_at';
    const order   = sortOrder === 'asc' ? 'asc' : 'desc';

    const safePage     = Math.max(1, Math.floor(page));
    const safePageSize = Math.max(1, Math.floor(pageSize));
    const offset       = (safePage - 1) * safePageSize;

    let dataQuery  = applyFilters(this._knex()(TABLE));
    let countQuery = applyFilters(this._knex()(TABLE));

    dataQuery = dataQuery
      .orderBy(sortCol, order)
      .limit(safePageSize)
      .offset(offset);

    const [rows, countResult] = await Promise.all([
      dataQuery,
      countQuery.count({ cnt: 'session_id' }).first(),
    ]);

    return {
      records: rows.map((r) => this._rowToRecord(r)),
      total:   Number(countResult?.cnt ?? 0),
    };
  }

  /**
   * Update the `lastActive` timestamp for a session.
   * No-op if the session does not exist.
   *
   * @param {string} sessionId
   * @param {number} timestamp — Unix ms
   * @returns {Promise<void>}
   */
  async updateLastActive(sessionId, timestamp) {
    await this._knex()(TABLE)
      .where({ session_id: sessionId })
      .update({ last_active: timestamp });
  }

  /**
   * Mark a session as revoked.
   * Must complete within 100 ms (Req 2.5).
   * No-op if the session does not exist.
   *
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  /**
   * Mark a session as revoked, optionally recording why and by whom.
   * Must complete within 100 ms (Req 2.5).
   * No-op if the session does not exist.
   *
   * @param {string} sessionId
   * @param {object} [opts]
   * @param {string} [opts.reason]    — e.g. 'logout', 'concurrent_limit', 'expired'
   * @param {number} [opts.revokedBy] — admin user ID that triggered revocation
   * @param {number} [opts.revokedAt] — Unix ms timestamp (defaults to Date.now())
   * @returns {Promise<void>}
   */
  async markRevoked(sessionId, { reason, revokedBy, revokedAt } = {}) {
    await this._knex()(TABLE)
      .where({ session_id: sessionId })
      .update({
        is_revoked:    1,
        revoke_reason: reason    || null,
        revoked_by:    revokedBy || null,
        revoked_at:    revokedAt || Date.now(),
      });
  }
}

module.exports = DatabaseStore;
