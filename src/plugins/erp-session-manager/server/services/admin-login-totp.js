'use strict';

/**
 * AdminLoginTotpService
 *
 * Tracks which admin users have completed password login but still need to
 * verify a TOTP code before the admin panel is accessible.
 *
 * State is stored in-memory (Map) and expires after PENDING_TTL_MS.
 * This is intentionally not persisted — a server restart clears all pending
 * states and forces re-login, which is the safe default.
 *
 * Used by:
 *   hooks/admin-auth.js      — sets pending flag after super admin login
 *   middlewares/step-up-auth.js — checks flag to gate /admin/* requests
 *   controllers/admin/step-up.js — clears flag after successful TOTP verify
 */

const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete TOTP after login

/**
 * How long an EXPIRED entry is kept after its window closed.
 *
 * Entries used to be deleted the moment they expired, which made "this user was
 * gated and never verified" indistinguishable from "this user was never gated".
 * The middleware read that as "no second factor needed" and let the request
 * through — so waiting out the 10 minutes granted full admin access on the
 * password alone. The expired entry IS the evidence, so it has to outlive the
 * window; the middleware consumes it by killing the session.
 *
 * Held for longer than admin.auth.sessions.maxRefreshTokenLifespan (8 h) so a
 * session can never outlive the record of its unfinished gate.
 */
const EXPIRED_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

const STATE_NONE    = 'none';
const STATE_PENDING = 'pending';
const STATE_EXPIRED = 'expired';

// Module-level Map so all three consumers share the same state
// Value shape: { expiresAt: number, setupRequired: boolean }
//   setupRequired: true  → user must complete first-time TOTP setup
//   setupRequired: false → user must verify existing TOTP code
const _pending = new Map();

module.exports = ({ strapi: _strapi }) => ({
  /**
   * Mark a user as requiring TOTP verification (already provisioned).
   * @param {number} userId
   */
  require(userId) {
    _pending.set(userId, { expiresAt: Date.now() + PENDING_TTL_MS, setupRequired: false });
  },

  /**
   * Mark a user as requiring first-time TOTP setup before admin access.
   * setupData is the { provisioningUri, base32Secret, qrCodeDataUri } object
   * returned by StepUpService.provisionSecret() — stored in memory so the same
   * QR code is returned on every 403 without re-generating a new secret.
   * @param {number} userId
   * @param {{ provisioningUri: string, base32Secret: string, qrCodeDataUri: string|null }} setupData
   */
  requireSetup(userId, setupData) {
    _pending.set(userId, {
      expiresAt:    Date.now() + PENDING_TTL_MS,
      setupRequired: true,
      setupData:    setupData || null,
    });
  },

  /**
   * Classify the gate for a user.
   *
   *   'none'    — no gate; the user never had one, or completed it.
   *   'pending' — gated, still inside the window; challenge them.
   *   'expired' — gated, window closed, TOTP never supplied. The caller MUST
   *               end the session rather than let the request through: this is
   *               the state that used to be reported as 'none'.
   *
   * Sweeps entries whose window closed long enough ago that the session they
   * belonged to cannot still exist.
   *
   * @param {number} userId
   * @returns {'none'|'pending'|'expired'}
   */
  getState(userId) {
    if (!userId) return STATE_NONE;
    const entry = _pending.get(userId);
    if (!entry) return STATE_NONE;

    const now = Date.now();
    if (now <= entry.expiresAt) return STATE_PENDING;

    if (now - entry.expiresAt > EXPIRED_RETENTION_MS) {
      _pending.delete(userId);
      return STATE_NONE;
    }
    return STATE_EXPIRED;
  },

  /**
   * Returns true if the user must complete TOTP before accessing the admin panel.
   *
   * Deliberately false once the window has closed — an expired gate is not a
   * challenge to re-issue, it is a session to terminate. Callers that need to
   * tell 'expired' from 'none' must use getState().
   *
   * @param {number} userId
   * @returns {boolean}
   */
  isPending(userId) {
    return this.getState(userId) === STATE_PENDING;
  },

  /**
   * Returns true if the user was gated at login and never supplied a code.
   * @param {number} userId
   * @returns {boolean}
   */
  isExpired(userId) {
    return this.getState(userId) === STATE_EXPIRED;
  },

  /**
   * Returns true if the pending gate requires first-time setup (not just a verify).
   * Only meaningful when isPending() is also true.
   * @param {number} userId
   * @returns {boolean}
   */
  isSetupRequired(userId) {
    if (!userId) return false;
    const entry = _pending.get(userId);
    if (!entry || Date.now() > entry.expiresAt) return false;
    return entry.setupRequired === true;
  },

  /**
   * Returns the pre-provisioned setup data for a user in setup-pending state.
   * Contains { provisioningUri, base32Secret, qrCodeDataUri } so the middleware
   * can return the QR code in the 403 response without re-generating a new secret.
   * Returns null if not in setup mode or entry expired.
   * @param {number} userId
   * @returns {{ provisioningUri: string, base32Secret: string, qrCodeDataUri: string|null }|null}
   */
  getSetupData(userId) {
    if (!userId) return null;
    const entry = _pending.get(userId);
    if (!entry || Date.now() > entry.expiresAt) return null;
    return entry.setupData || null;
  },

  /**
   * Clear the pending TOTP flag — called after successful TOTP verification or setup.
   * @param {number} userId
   */
  clear(userId) {
    _pending.delete(userId);
  },
});
