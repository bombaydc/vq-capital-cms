'use strict';

const isScalarId = (v) => typeof v === 'number' || typeof v === 'string';

/**
 * Read the id(s) out of one `id` clause value: a bare id, `{ $eq }` or
 * `{ $in: [...] }`. Anything else yields nothing.
 *
 * @param {*} value
 * @returns {Array<number|string>}
 */
function idsFromClause(value) {
  if (isScalarId(value)) return [value];
  if (!value || typeof value !== 'object') return [];

  const out = [];
  if (isScalarId(value.$eq)) out.push(value.$eq);
  if (Array.isArray(value.$in)) out.push(...value.$in.filter(isScalarId));
  return out;
}


/**
 * EmailUniqueness Service (VAPT #5 — Duplicate Email / Business Logic Flaw)
 *
 * Application-layer email uniqueness enforcement that runs BEFORE the DB write.
 * This layer catches duplicates with a clear 400 error and an audit trail;
 * the DB UNIQUE constraint (migration 002) is the final backstop that catches
 * race conditions.
 *
 * Two separate check surfaces:
 *   checkAdmin(email, excludeId) — admin_users table (Strapi admin panel users)
 *   checkUser(email, excludeId)  — up_users table (users-permissions content-API users)
 *
 * Both methods normalise the email before querying (trim + lowercase) matching
 * what the email-canonicalizer middleware does on ingress, so this works even
 * if called with an already-normalised value.
 *
 * References: VAPT Finding #5, Design §15.5
 */

module.exports = ({ strapi }) => ({
  /**
   * Normalise an email address (trim + lowercase).
   * Returns null if the value is not a non-empty string.
   *
   * @param {*} email
   * @returns {string|null}
   */
  normalize(email) {
    if (typeof email !== 'string' || !email.trim()) return null;
    return email.trim().toLowerCase();
  },

  /**
   * Pull the row id(s) a Strapi query-engine `where` clause targets, so an
   * UPDATE can exclude the row it is rewriting from its own duplicate check.
   *
   * Handles the shapes the ORM actually emits:
   *   { id: 5 }                → [5]     ← update-by-id, the common case
   *   { id: { $eq: 5 } }       → [5]
   *   { id: { $in: [5, 6] } }  → [5, 6]
   *   { $and: [{ id: 5 }, …] } → [5]
   *
   * Returns [] when no id can be read. Callers then check the email against
   * every row, which can reject a legitimate update — but the alternative is
   * letting an unrecognised clause through unchecked, and there is no DB UNIQUE
   * index on either email column to catch it (see the note in server/index.js).
   *
   * @param {*} where
   * @returns {Array<number|string>}
   */
  resolveExcludeIds(where) {
    const ids = [];

    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(visit); return; }

      for (const [key, value] of Object.entries(node)) {
        if (key === '$and' || key === '$or') visit(value);
        else if (key === 'id') ids.push(...idsFromClause(value));
      }
    };

    visit(where);
    return ids;
  },

  /**
   * Normalise the excludeId argument to an array. Accepts a bare id (the
   * historical signature) or an array from resolveExcludeIds().
   *
   * @param {number|string|Array<number|string>|null|undefined} excludeId
   * @returns {Array<number|string>}
   */
  _toExcludeList(excludeId) {
    if (Array.isArray(excludeId)) return excludeId.filter((v) => v !== null && v !== undefined);
    if (excludeId === null || excludeId === undefined) return [];
    return [excludeId];
  },

  // ---------------------------------------------------------------------------
  // Admin users (admin_users table)
  // ---------------------------------------------------------------------------

  /**
   * Check if an email already exists in admin_users.
   *
   * @param {string} email    — raw or pre-normalised email address
   * @param {number} [excludeId] — row ID to exclude (used for updates)
   * @returns {Promise<boolean>} true if a duplicate exists
   */
  async isAdminEmailTaken(email, excludeId) {
    const normalised = this.normalize(email);
    if (!normalised) return false;

    const query = strapi.db.connection('admin_users')
      .whereRaw('LOWER(TRIM(email)) = ?', [normalised])
      .count('id as cnt')
      .first();

    const excluded = this._toExcludeList(excludeId);
    if (excluded.length === 1) {
      query.andWhere('id', '!=', excluded[0]);
    } else if (excluded.length > 1) {
      query.whereNotIn('id', excluded);
    }

    const row = await query;
    return parseInt(row.cnt, 10) > 0;
  },

  /**
   * Assert that the given email is not already taken in admin_users.
   * Throws a Strapi ApplicationError (HTTP 400) if a duplicate is found.
   *
   * @param {string} email
   * @param {number} [excludeId]
   */
  async enforceAdminEmailUnique(email, excludeId) {
    const taken = await this.isAdminEmailTaken(email, excludeId);
    if (taken) {
      this._emitDuplicateEvent({ email, table: 'admin_users' });
      const err = new Error('An account with this email address already exists.');
      err.name  = 'ApplicationError';
      err.status = 400;
      err.details = { field: 'email', reason: 'DUPLICATE_EMAIL' };
      throw err;
    }
  },

  // ---------------------------------------------------------------------------
  // Content-API users (up_users table)
  // ---------------------------------------------------------------------------

  /**
   * Check if an email already exists in up_users.
   *
   * @param {string} email
   * @param {number} [excludeId]
   * @returns {Promise<boolean>}
   */
  async isUserEmailTaken(email, excludeId) {
    const normalised = this.normalize(email);
    if (!normalised) return false;

    const query = strapi.db.connection('up_users')
      .whereRaw('LOWER(TRIM(email)) = ?', [normalised])
      .count('id as cnt')
      .first();

    const excluded = this._toExcludeList(excludeId);
    if (excluded.length === 1) {
      query.andWhere('id', '!=', excluded[0]);
    } else if (excluded.length > 1) {
      query.whereNotIn('id', excluded);
    }

    const row = await query;
    return parseInt(row.cnt, 10) > 0;
  },

  /**
   * Assert that the given email is not already taken in up_users.
   * Throws a Strapi ApplicationError (HTTP 400) if a duplicate is found.
   *
   * @param {string} email
   * @param {number} [excludeId]
   */
  async enforceUserEmailUnique(email, excludeId) {
    const taken = await this.isUserEmailTaken(email, excludeId);
    if (taken) {
      this._emitDuplicateEvent({ email, table: 'up_users' });
      const err = new Error('An account with this email address already exists.');
      err.name   = 'ApplicationError';
      err.status  = 400;
      err.details = { field: 'email', reason: 'DUPLICATE_EMAIL' };
      throw err;
    }
  },

  // ---------------------------------------------------------------------------
  // Audit helper
  // ---------------------------------------------------------------------------

  /**
   * Fire-and-forget audit event for a duplicate-email attempt.
   * Uses the erp-session-manager auditLogger if available.
   *
   * @param {{ email: string, table: string }} meta
   */
  _emitDuplicateEvent({ email, table }) {
    try {
      const auditLogger = strapi.plugin('erp-session-manager').service('auditLogger');
      auditLogger.log({
        eventType: 'DUPLICATE_EMAIL_ATTEMPT',
        outcome:   'FAILURE',
        metadata:  {
          email:    this.normalize(email),
          table,
          reason:   'DUPLICATE_EMAIL',
        },
      });
    } catch {
      // Audit log failure must never block the response
    }
  },
});
