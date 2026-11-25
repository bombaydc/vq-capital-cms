'use strict';

/**
 * ContentLoginTotpService
 *
 * Tracks which content-API users have completed password login (POST /api/auth/local)
 * but still need to verify a TOTP code before content-API endpoints are accessible.
 *
 * State is stored in-memory (Map) and expires after PENDING_TTL_MS.
 * A server restart clears all pending states, forcing re-login — the safe default.
 *
 * Only activated for users who have provisioned a TOTP secret via the admin panel.
 * Users without TOTP provisioned are not affected.
 *
 * Used by:
 *   hooks/users-permissions.js   — sets pending flag after content-API login
 *   middlewares/session-auth.js  — checks flag to gate content-API requests
 *   controllers/user/content-login-totp.js — clears flag after successful TOTP verify
 *
 * VAPT #12 — Content-API TOTP enforcement
 */

const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete TOTP after login

// Module-level Map so all three consumers share the same state
// Value shape: { expiresAt: number }
const _pending = new Map();

module.exports = ({ strapi: _strapi }) => ({
  /**
   * Mark a user as requiring TOTP verification before content-API access.
   * Called after a successful password login when the user has TOTP provisioned.
   * @param {number} userId
   */
  require(userId) {
    _pending.set(userId, { expiresAt: Date.now() + PENDING_TTL_MS });
  },

  /**
   * Returns true if the user must verify TOTP before accessing content-API endpoints.
   * Automatically removes stale (expired) entries.
   * @param {number} userId
   * @returns {boolean}
   */
  isPending(userId) {
    if (!userId) return false;
    const entry = _pending.get(userId);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      _pending.delete(userId);
      return false;
    }
    return true;
  },

  /**
   * Clear the pending TOTP flag — called after successful TOTP verification.
   * @param {number} userId
   */
  clear(userId) {
    _pending.delete(userId);
  },

  // ---------------------------------------------------------------------------
  // Exported internals — for unit-test Map isolation via jest.resetModules()
  // ---------------------------------------------------------------------------
  _pending,
  PENDING_TTL_MS,
});
