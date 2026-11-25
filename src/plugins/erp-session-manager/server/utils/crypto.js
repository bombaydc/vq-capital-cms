'use strict';

const crypto = require('crypto');

/**
 * CryptoUtils — token generation and hashing helpers.
 *
 * References: Req 2.1, Req 15.2, Design §9.4
 */

module.exports = {
  /**
   * generateSessionId()
   * Generates a 128-bit cryptographically random session ID as a hex string.
   * @returns {string} 32-character hex string
   */
  generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
  },

  /**
   * generateRefreshToken()
   * Generates a 256-bit cryptographically random refresh token as a hex string.
   * @returns {string} 64-character hex string
   */
  generateRefreshToken() {
    return crypto.randomBytes(32).toString('hex');
  },

  /**
   * hashToken(raw)
   * Computes the SHA-256 hex digest of a raw token string.
   * Used to store a non-reversible representation of the refresh token.
   * @param {string} raw — raw token value
   * @returns {string} 64-character hex SHA-256 digest
   */
  hashToken(raw) {
    return crypto.createHash('sha256').update(raw).digest('hex');
  },
};
