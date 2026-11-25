'use strict';

const ISessionStore = require('./interface');

/** Expiring-soon threshold in milliseconds (30 minutes). */
const EXPIRING_SOON_MS = 30 * 60 * 1000;

/**
 * MemoryStore -- in-memory ISessionStore implementation.
 *
 * Uses a primary Map<sessionId, Session_Record> for O(1) lookups and a
 * secondary Map<userId, Set<sessionId>> for user-indexed lookups (Design SS5.1).
 *
 * Suitable for development and single-instance deployments.
 * Session data is lost on process restart.
 *
 * All methods are synchronous -- memory operations complete in microseconds,
 * well within the 100 ms requirement for markRevoked (Req 2.5).
 */
class MemoryStore extends ISessionStore {
  constructor() {
    super();
    /**
     * Primary store: sessionId -> Session_Record
     * @type {Map<string, object>}
     */
    this._sessions = new Map();

    /**
     * User index: userId -> Set<sessionId>
     * Enables O(1) user-scoped lookups without scanning all sessions.
     * @type {Map<number, Set<string>>}
     */
    this._userIndex = new Map();

    /**
     * TTL timer handles: sessionId -> NodeJS.Timeout
     * Kept so timers can be cleared on explicit delete.
     * @type {Map<string, ReturnType<typeof setTimeout>>}
     */
    this._timers = new Map();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Remove a session from both the primary store and the user index.
   * Clears any pending TTL timer.
   * @param {string} sessionId
   * @returns {boolean} true if the session existed and was removed
   */
  _removeSession(sessionId) {
    const record = this._sessions.get(sessionId);
    if (!record) return false;

    // Clear TTL timer if one is pending.
    const timer = this._timers.get(sessionId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this._timers.delete(sessionId);
    }

    // Remove from user index.
    const userSet = this._userIndex.get(record.userId);
    if (userSet) {
      userSet.delete(sessionId);
      if (userSet.size === 0) {
        this._userIndex.delete(record.userId);
      }
    }

    // Remove from primary store.
    this._sessions.delete(sessionId);
    return true;
  }

  // ---------------------------------------------------------------------------
  // ISessionStore implementation
  // ---------------------------------------------------------------------------

  /**
   * Retrieve a single Session_Record by its ID.
   *
   * @param {string} sessionId
   * @returns {object|null}
   */
  get(sessionId) {
    return this._sessions.get(sessionId) ?? null;
  }

  /**
   * Persist a Session_Record with an optional TTL.
   * If the session already exists it is overwritten.
   * When ttlMs is provided a setTimeout is scheduled to auto-delete the record.
   *
   * @param {string} sessionId
   * @param {object} record
   * @param {number} [ttlMs]
   * @returns {void}
   */
  set(sessionId, record, ttlMs) {
    // If a previous entry exists, clean up its timer and user-index entry first.
    if (this._sessions.has(sessionId)) {
      this._removeSession(sessionId);
    }

    // Store the record.
    this._sessions.set(sessionId, record);

    // Update user index.
    const userId = record.userId;
    if (!this._userIndex.has(userId)) {
      this._userIndex.set(userId, new Set());
    }
    this._userIndex.get(userId).add(sessionId);

    // Schedule TTL expiry if requested.
    if (typeof ttlMs === 'number' && ttlMs > 0) {
      const timer = setTimeout(() => {
        this._removeSession(sessionId);
      }, ttlMs);
      // Allow the Node.js process to exit even if this timer is pending.
      if (timer.unref) timer.unref();
      this._timers.set(sessionId, timer);
    }
  }

  /**
   * Remove a Session_Record and clean up all secondary indexes.
   *
   * @param {string} sessionId
   * @returns {void}
   */
  delete(sessionId) {
    this._removeSession(sessionId);
  }

  /**
   * Retrieve all Session_Records for a given user.
   *
   * @param {number} userId
   * @returns {object[]}
   */
  getByUser(userId) {
    const ids = this._userIndex.get(userId);
    if (!ids || ids.size === 0) return [];

    const records = [];
    for (const id of ids) {
      const record = this._sessions.get(id);
      if (record) records.push(record);
    }
    return records;
  }

  /**
   * Delete all Session_Records for a given user.
   *
   * @param {number} userId
   * @returns {number} count of deleted records
   */
  deleteByUser(userId) {
    const ids = this._userIndex.get(userId);
    if (!ids || ids.size === 0) return 0;

    // Copy the set before iterating because _removeSession mutates it.
    const idsCopy = Array.from(ids);
    let count = 0;
    for (const id of idsCopy) {
      if (this._removeSession(id)) count++;
    }
    return count;
  }

  /**
   * Delete multiple Session_Records by ID.
   * Silently skips IDs that do not exist.
   *
   * @param {string[]} sessionIds
   * @returns {number} count of actually deleted records
   */
  deleteMany(sessionIds) {
    let count = 0;
    for (const id of sessionIds) {
      if (this._removeSession(id)) count++;
    }
    return count;
  }

  /**
   * List all Session_Records with optional filters and pagination.
   *
   * @param {object} [filters]
   * @param {number}  [filters.userId]
   * @param {string}  [filters.ip]
   * @param {string}  [filters.status]    'active' | 'anomaly' | 'expiring'
   * @param {string}  [filters.sortBy]    'issuedAt' | 'lastActive' | 'expiresAt'
   * @param {string}  [filters.sortOrder] 'asc' | 'desc'
   * @param {number}  [filters.page]      1-based (default 1)
   * @param {number}  [filters.pageSize]  (default 25)
   * @returns {{ records: object[], total: number }}
   */
  listAll(filters = {}) {
    const {
      userId,
      ip,
      status,
      sortBy,
      sortOrder = 'desc',
      page = 1,
      pageSize = 25,
    } = filters;

    const now = Date.now();
    let records = Array.from(this._sessions.values());

    // --- Filtering ---

    if (userId !== undefined && userId !== null) {
      records = records.filter((r) => r.userId === userId);
    }

    if (ip) {
      records = records.filter((r) => r.ipAddress === ip);
    }

    if (status) {
      switch (status) {
        case 'active':
          records = records.filter(
            (r) => !r.isRevoked && r.expiresAt > now
          );
          break;
        case 'anomaly':
          records = records.filter(
            (r) => Array.isArray(r.anomalyFlags) && r.anomalyFlags.length > 0
          );
          break;
        case 'expiring':
          records = records.filter(
            (r) =>
              !r.isRevoked &&
              r.expiresAt > now &&
              r.expiresAt - now <= EXPIRING_SOON_MS
          );
          break;
        default:
          // Unknown status -- return no results rather than silently ignoring.
          records = [];
      }
    }

    // --- Sorting ---

    const SORT_FIELDS = ['issuedAt', 'lastActive', 'expiresAt'];
    if (sortBy && SORT_FIELDS.includes(sortBy)) {
      const direction = sortOrder === 'asc' ? 1 : -1;
      records = records.slice().sort((a, b) => {
        const av = a[sortBy] ?? 0;
        const bv = b[sortBy] ?? 0;
        return (av - bv) * direction;
      });
    }

    // --- Pagination ---

    const total = records.length;
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.max(1, Math.floor(pageSize));
    const start = (safePage - 1) * safePageSize;
    const paginatedRecords = records.slice(start, start + safePageSize);

    return { records: paginatedRecords, total };
  }

  /**
   * Update the lastActive timestamp on a Session_Record in-place.
   * No-op if the session does not exist.
   *
   * @param {string} sessionId
   * @param {number} timestamp - Unix timestamp in milliseconds
   * @returns {void}
   */
  updateLastActive(sessionId, timestamp) {
    const record = this._sessions.get(sessionId);
    if (record) {
      record.lastActive = timestamp;
    }
  }

  /**
   * Mark a Session_Record as revoked by setting isRevoked: true.
   * Synchronous Map mutation -- completes in microseconds (well within 100 ms, Req 2.5).
   * No-op if the session does not exist.
   *
   * VAPT #10 Gap 4: Accept revocation metadata options so audit fields
   * (reason, revokedBy, revokedAt) are preserved on the in-memory record
   * and not silently dropped when DatabaseStore also receives them.
   *
   * @param {string} sessionId
   * @param {{ reason?: string, revokedBy?: number|null, revokedAt?: number }} [options]
   * @returns {void}
   */
  markRevoked(sessionId, options = {}) {
    const record = this._sessions.get(sessionId);
    if (record) {
      record.isRevoked  = true;
      if (options.reason    !== undefined) record.revokeReason = options.reason;
      if (options.revokedBy !== undefined) record.revokedBy    = options.revokedBy;
      if (options.revokedAt !== undefined) record.revokedAt    = options.revokedAt;
    }
  }
}

module.exports = MemoryStore;
