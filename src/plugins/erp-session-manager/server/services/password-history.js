'use strict';

/**
 * PasswordHistoryService — stores and validates password history.
 *
 * Prevents users from reusing any of their last N passwords (VAPT #27).
 * Each password change records a bcrypt hash of the new password.
 * On the next change attempt, the new plaintext is compared against stored
 * hashes using bcrypt.compare() — the only secure way to compare against
 * bcrypt-hashed values.
 *
 * userType distinguishes admin users ("admin") from content-API users
 * ("content-api") because both pools share integer IDs in different DB tables.
 *
 * References: VAPT #27, NIST SP 800-63B §5.1.1.2
 */

const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 10;

module.exports = ({ strapi }) => ({

  /**
   * checkReuse(userId, userType, plaintext, historyCount)
   *
   * Queries the last `historyCount` password history records for this user
   * and checks whether `plaintext` matches any of them via bcrypt.compare().
   *
   * @param {number}  userId       — user ID
   * @param {string}  userType     — 'admin' | 'content-api'
   * @param {string}  plaintext    — the new password candidate (plaintext)
   * @param {number}  historyCount — how many previous passwords to check (0 = disabled)
   * @returns {Promise<boolean>}   true if the password is being reused
   */
  async checkReuse(userId, userType, plaintext, historyCount) {
    if (!historyCount || historyCount <= 0) return false;
    if (!userId || typeof plaintext !== 'string' || plaintext.length === 0) return false;

    let records;
    try {
      records = await strapi
        .documents('plugin::erp-session-manager.erp-password-history')
        .findMany({
          filters: {
            userId:   { $eq: userId },
            userType: { $eq: userType },
          },
          sort:   [{ changedAt: 'desc' }],
          limit:  historyCount,
          fields: ['passwordHash'],
        });
    } catch (err) {
      strapi.log.warn(`[erp-session-manager] Password history read error (treating as no reuse): ${err.message}`);
      return false;
    }

    if (!records || records.length === 0) return false;

    for (const rec of records) {
      try {
        if (await bcrypt.compare(plaintext, rec.passwordHash)) {
          return true;
        }
      } catch {
        // If a stored hash is malformed, skip it — do not block the user
      }
    }

    return false;
  },

  /**
   * record(userId, userType, plaintext, historyCount)
   *
   * Hashes the new password with bcrypt and stores it as a history record.
   * After writing, prunes entries beyond `historyCount` (oldest-first).
   *
   * @param {number}  userId       — user ID
   * @param {string}  userType     — 'admin' | 'content-api'
   * @param {string}  plaintext    — the new password (plaintext — hashed here)
   * @param {number}  historyCount — max records to retain per user
   * @returns {Promise<void>}
   */
  async record(userId, userType, plaintext, historyCount) {
    if (!userId || typeof plaintext !== 'string' || plaintext.length === 0) return;

    const passwordHash = await bcrypt.hash(plaintext, BCRYPT_ROUNDS);
    const changedAt    = new Date().toISOString();

    await strapi
      .documents('plugin::erp-session-manager.erp-password-history')
      .create({
        data: { userId, userType, passwordHash, changedAt },
      });

    // Prune: keep only the N most recent entries
    if (historyCount > 0) {
      await this._prune(userId, userType, historyCount);
    }
  },

  /**
   * _prune(userId, userType, keepCount)
   *
   * Deletes the oldest history entries so that at most `keepCount` remain
   * for this (userId, userType) pair.
   *
   * @param {number}  userId    — user ID
   * @param {string}  userType  — 'admin' | 'content-api'
   * @param {number}  keepCount — maximum records to retain
   * @returns {Promise<void>}
   */
  async _prune(userId, userType, keepCount) {
    if (keepCount <= 0) return;

    const all = await strapi
      .documents('plugin::erp-session-manager.erp-password-history')
      .findMany({
        filters: {
          userId:   { $eq: userId },
          userType: { $eq: userType },
        },
        sort:   [{ changedAt: 'asc' }], // oldest first
        fields: ['documentId', 'changedAt'],
      });

    if (!all || all.length <= keepCount) return;

    const toDelete = all.slice(0, all.length - keepCount);
    for (const rec of toDelete) {
      try {
        await strapi
          .documents('plugin::erp-session-manager.erp-password-history')
          .delete({ documentId: rec.documentId });
      } catch (err) {
        strapi.log.warn(`[erp-session-manager] Failed to prune password history entry ${rec.documentId}: ${err.message}`);
      }
    }
  },
});
