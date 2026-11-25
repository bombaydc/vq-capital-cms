'use strict';

/**
 * TokenRevocationService — O(1) in-memory revocation tracking.
 *
 * Maintains two in-memory data structures:
 *   revokedHashes              — Set of SHA-256 refresh-token hashes
 *   userRevocationTimestamps   — Map<userId, ms> for bulk user revocations
 *
 * At bootstrap, `initialize()` pre-loads recently-revoked session hashes from
 * the DB so that tokens revoked before a server restart are still blocked
 * (G9/G10: restart persistence).
 *
 * The O(1) Set lookup in session-auth.js short-circuits the DB round-trip for
 * any token that is already known to be revoked (G9).
 *
 * `revokeAllUserTokens(userId)` sets a timestamp in the Map.  session-auth.js
 * rejects any JWT whose iat (issued-at ms) predates that timestamp (G14).
 *
 * References: Gap G9, G10, G14
 */

module.exports = ({ strapi }) => {
  /** @type {Set<string>} SHA-256 hashes of revoked refresh tokens */
  const revokedHashes = new Set();

  /** @type {Map<number, number>} userId → revocation timestamp (ms) */
  const userRevocationTimestamps = new Map();

  return {
    // Expose the Set so session-auth.js can read it directly without a method call
    revokedHashes,

    /**
     * initialize()
     *
     * Pre-populates revokedHashes from the DB at bootstrap.
     * Only loads sessions whose lastActive is within policy.sessionRetentionDays
     * to keep the Set bounded.
     *
     * @returns {Promise<void>}
     */
    async initialize() {
      try {
        const storeModule = require('./store');
        const store = storeModule.getStore();

        // Determine retention window from policy (or static config as fallback)
        let retentionDays = 90;
        try {
          const policyService = strapi.plugin('erp-session-manager').service('policy');
          const policy = await policyService.getPolicy();
          retentionDays = policy.sessionRetentionDays ?? 90;
        } catch {
          // Use default if policy service not yet available
        }

        const cutoff = Date.now() - retentionDays * 86400000;

        const { records } = await store.listAll({
          status:   'revoked-only',
          page:     1,
          pageSize: 50000, // large but bounded by retention window
        });

        let loaded = 0;
        for (const r of records) {
          if (r.refreshTokenHash && r.lastActive > cutoff) {
            revokedHashes.add(r.refreshTokenHash);
            loaded++;
          }
        }

        strapi.log.info(
          `[token-revocation] Pre-loaded ${loaded} revoked token hashes into memory.`
        );
      } catch (err) {
        strapi.log.warn(
          `[token-revocation] Could not pre-load revoked hashes: ${err.message}`
        );
      }
    },

    /**
     * revokeByHash(hash)
     * Adds a refresh-token SHA-256 hash to the in-memory revocation Set.
     * @param {string} hash
     */
    revokeByHash(hash) {
      if (hash) revokedHashes.add(hash);
    },

    /**
     * isRevokedByHash(hash)
     * O(1) check — returns true if the hash is in the revocation Set.
     * @param {string} hash
     * @returns {boolean}
     */
    isRevokedByHash(hash) {
      return revokedHashes.has(hash);
    },

    /**
     * revokeAllUserTokens(userId)
     * Records the current timestamp for this user.  Any JWT with
     * iat < this timestamp will be rejected by session-auth.js (G14).
     * @param {number} userId
     */
    revokeAllUserTokens(userId) {
      if (userId) userRevocationTimestamps.set(Number(userId), Date.now());
    },

    /**
     * isUserRevoked(userId, tokenIssuedAtMs)
     * Returns true if a per-user revocation timestamp exists and the token
     * was issued before that timestamp.
     * @param {number} userId
     * @param {number} tokenIssuedAtMs — JWT iat converted to milliseconds
     * @returns {boolean}
     */
    isUserRevoked(userId, tokenIssuedAtMs) {
      const ts = userRevocationTimestamps.get(Number(userId));
      return ts !== undefined && tokenIssuedAtMs < ts;
    },
  };
};
