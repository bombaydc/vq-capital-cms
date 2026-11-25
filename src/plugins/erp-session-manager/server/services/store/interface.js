'use strict';

/**
 * ISessionStore -- interface definition for session store backends.
 *
 * DatabaseStore, RedisStore, HybridStore and MemoryStore must implement all
 * methods below. This file serves as documentation; JavaScript does not enforce
 * interfaces at runtime, but the Store_Backend_Selector relies on duck-typing.
 *
 * Every method is declared as Promise-returning because the default backend
 * (DatabaseStore) and the Redis/Hybrid backends are all `async`. MemoryStore
 * resolves synchronously, which callers `await` harmlessly. Consumers must
 * therefore treat the whole interface as asynchronous and always `await`.
 *
 * Do not weaken these @returns to bare value types: `_getStore()` is typed as
 * `import('./store/interface')`, so this JSDoc *is* the type contract the
 * analyzer resolves at every call site. Declaring `{void}` here made SonarQube
 * infer that `await store.markRevoked(...)` awaited a non-Promise (S4123) and
 * that `sessions.map(s => store.markRevoked(s))` returned nothing (S3796,
 * blocker) in session.js -- both phantom findings caused purely by this file.
 *
 * Design SS5.1
 */

/**
 * @interface ISessionStore
 */
class ISessionStore {
  /**
   * Retrieve a single Session_Record by its ID.
   *
   * @param {string} sessionId - 128-bit CSPRNG hex (32 chars)
   * @returns {Promise<object|null>} Session_Record or null if not found
   */
  // eslint-disable-next-line no-unused-vars
  get(sessionId) { throw new Error('Not implemented'); }

  /**
   * Persist a Session_Record with an optional TTL.
   * When ttlMs is provided, the record is automatically deleted after that duration.
   *
   * @param {string} sessionId - 128-bit CSPRNG hex (32 chars)
   * @param {object} record    - Session_Record (see Design SS4.1)
   * @param {number} [ttlMs]   - time-to-live in milliseconds
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  set(sessionId, record, ttlMs) { throw new Error('Not implemented'); }

  /**
   * Remove a Session_Record and clean up all secondary indexes.
   *
   * @param {string} sessionId - 128-bit CSPRNG hex (32 chars)
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  delete(sessionId) { throw new Error('Not implemented'); }

  /**
   * Retrieve all Session_Records for a given user.
   *
   * @param {number} userId - Strapi user ID
   * @returns {Promise<object[]>} array of Session_Records (may be empty)
   */
  // eslint-disable-next-line no-unused-vars
  getByUser(userId) { throw new Error('Not implemented'); }

  /**
   * Delete all Session_Records for a given user.
   *
   * @param {number} userId - Strapi user ID
   * @returns {Promise<number>} count of deleted records
   */
  // eslint-disable-next-line no-unused-vars
  deleteByUser(userId) { throw new Error('Not implemented'); }

  /**
   * Delete multiple Session_Records by ID.
   * Silently skips IDs that do not exist.
   *
   * @param {string[]} sessionIds - array of session ID strings
   * @returns {Promise<number>} count of actually deleted records
   */
  // eslint-disable-next-line no-unused-vars
  deleteMany(sessionIds) { throw new Error('Not implemented'); }

  /**
   * List all Session_Records with optional filters and pagination.
   *
   * Supported filters:
   *   userId    {number}  - filter by Strapi user ID
   *   ip        {string}  - filter by IP address (exact match)
   *   status    {string}  - 'active'    : not revoked AND not expired
   *                         'anomaly'   : has one or more anomalyFlags
   *                         'expiring'  : expires within 30 minutes
   *   sortBy    {string}  - 'issuedAt' | 'lastActive' | 'expiresAt'
   *   sortOrder {string}  - 'asc' | 'desc' (default: 'desc')
   *   page      {number}  - 1-based page number (default: 1)
   *   pageSize  {number}  - records per page (default: 25)
   *
   * @param {object} [filters] - optional filter/sort/pagination options
   * @returns {Promise<{ records: object[], total: number }>}
   */
  // eslint-disable-next-line no-unused-vars
  listAll(filters) { throw new Error('Not implemented'); }

  /**
   * Update the lastActive timestamp on a Session_Record in-place.
   * No-op if the session does not exist.
   *
   * @param {string} sessionId - 128-bit CSPRNG hex (32 chars)
   * @param {number} timestamp - Unix timestamp in milliseconds
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  updateLastActive(sessionId, timestamp) { throw new Error('Not implemented'); }

  /**
   * Mark a Session_Record as revoked by setting isRevoked: true.
   * Must complete within 100 ms (Req 2.5).
   * No-op if the session does not exist.
   *
   * @param {string} sessionId           - 128-bit CSPRNG hex (32 chars)
   * @param {object} [options]           - revocation metadata
   * @param {string} [options.reason]    - why the session was revoked
   * @param {number} [options.revokedBy] - user ID that triggered the revocation
   * @param {number} [options.revokedAt] - Unix timestamp in milliseconds
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  markRevoked(sessionId, options) { throw new Error('Not implemented'); }
}

module.exports = ISessionStore;
