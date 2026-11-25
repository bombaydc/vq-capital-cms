'use strict';

/**
 * SessionService — CRUD operations on Session_Records.
 *
 * Responsible for creating, validating, revoking, and expiring sessions.
 * Delegates persistence to the active ISessionStore instance.
 *
 * Key methods (Design §5.2):
 *   createSession({ userId, ipAddress, userAgent, rawRefreshToken })
 *   validateRefreshToken(rawRefreshToken)
 *   revokeSession(sessionId)
 *   revokeAllForUser(userId)
 *   checkTimeouts(sessionRecord)
 *   enforceMaxConcurrent(userId)
 *   rotateRefreshToken(sessionId)
 *
 * References: Req 2–4, Req 15, Design §5.2
 */

const storeModule = require('./store');
const CryptoUtils = require('../utils/crypto');
const { sanitizeUserAgent, sanitizeIpAddress } = require('../utils/sanitize-ua');
const geo          = require('../utils/geo');

module.exports = ({ strapi }) => ({
  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Retrieve the resolved plugin config object (static fallback).
   * @returns {object}
   */
  _getConfig() {
    return strapi.config.get('plugin::erp-session-manager');
  },

  /**
   * Retrieve the live policy (DB-backed, 5-min cache).
   * Falls back to a minimal object derived from static config on error.
   * @returns {Promise<object>}
   */
  async _getPolicy() {
    try {
      return await strapi.plugin('erp-session-manager').service('policy').getPolicy();
    } catch {
      const c = this._getConfig();
      const s = c?.sessions || {};
      return {
        maxConcurrentSessions: s.maxConcurrent   ?? 3,
        idleTimeoutMinutes:    (s.idleTimeout     ?? 1800) / 60,
        absoluteTimeoutHours:  (s.absoluteTimeout ?? 28800) / 3600,
        evictionPolicy:        s.evictionPolicy ?? 'oldest-first',
      };
    }
  },

  /**
   * Retrieve the active ISessionStore instance.
   * @returns {import('./store/interface')}
   */
  _getStore() {
    return storeModule.getStore();
  },

  /**
   * Retrieve the AuditLogger service if available.
   * Returns null if the service is not yet registered (e.g. during tests).
   * @returns {object|null}
   */
  _getAuditLogger() {
    try {
      return strapi.plugin('erp-session-manager').service('auditLogger');
    } catch {
      return null;
    }
  },

  // ---------------------------------------------------------------------------
  // createSession
  // ---------------------------------------------------------------------------

  /**
   * createSession({ userId, ipAddress, userAgent, rawRefreshToken })
   *
   * Stores a new Session_Record and returns the session credentials.
   *
   * - Generates a new sessionId via CryptoUtils.generateSessionId()
   *   (session fixation prevention, Req 15.1, Req 15.4)
   * - If rawRefreshToken is not provided, generates one via
   *   CryptoUtils.generateRefreshToken()
   * - Hashes the token via CryptoUtils.hashToken()
   * - Builds a Session_Record with all fields from Design §4.1
   * - Stores via store.set(sessionId, record, ttlMs)
   *   where ttlMs = refreshTokenTtl * 1000
   * - Returns { sessionId, refreshToken: rawToken, expiresAt }
   *
   * @param {object} params
   * @param {number}  params.userId
   * @param {string}  params.ipAddress
   * @param {string}  params.userAgent
   * @param {string}  [params.rawRefreshToken] — optional; generated if omitted
   * @param {'admin'|'content'} [params.sessionType] — which ID space userId belongs
   *   to. admin_users.id and up_users.id are independent sequences that both start
   *   at 1, so records must be tagged or a lookup by userId alone can return the
   *   wrong person's session.
   * @returns {{ sessionId: string, refreshToken: string, expiresAt: number }}
   */
  async createSession({ userId, ipAddress, userAgent, rawRefreshToken, deviceHash, sessionType }) {
    const config = this._getConfig();
    const store = this._getStore();

    // Session fixation prevention: always generate a fresh session ID (Req 15.1)
    const sessionId = CryptoUtils.generateSessionId();

    // Generate refresh token if not supplied
    const rawToken = rawRefreshToken || CryptoUtils.generateRefreshToken();
    const refreshTokenHash = CryptoUtils.hashToken(rawToken);

    const refreshTokenTtl =
      config &&
      config.tokens &&
      typeof config.tokens.refreshTokenTtl === 'number'
        ? config.tokens.refreshTokenTtl
        : 28800; // 8 hours default

    const now = Date.now();
    const expiresAt = now + refreshTokenTtl * 1000;

    // Resolve geolocation for this IP (VAPT #24 — enables impossible-travel detection).
    // geo.lookup() returns null when the GeoLite2 DB is not loaded; fallback to nulls
    // so impossible-travel is silently skipped rather than crashing (Req 5.7).
    const sanitizedIp = ipAddress ? sanitizeIpAddress(ipAddress) : null;
    const geoLoc = (sanitizedIp && geo.lookup(sanitizedIp)) ||
      { city: null, country: null, lat: null, lon: null };

    // Build Session_Record (Design §4.1)
    const record = {
      sessionId,
      userId,
      sessionType: sessionType === 'admin' ? 'admin' : 'content',
      refreshTokenHash,
      issuedAt: now,
      lastActive: now,
      expiresAt,
      ipAddress: sanitizedIp,
      userAgent: userAgent ? sanitizeUserAgent(userAgent) : null,
      geoLocation: geoLoc,
      isRevoked: false,
      anomalyFlags: [],
      deviceId:   CryptoUtils.hashToken(`${userAgent ? sanitizeUserAgent(userAgent) : ''}:${sanitizedIp || ''}`),
      // G13: device fingerprint (SHA-256 of UA, passed in by caller)
      deviceHash: deviceHash || null,
      rotationCount: 0,
      revokeReason:  null,
      revokedBy:     null,
      revokedAt:     null,
    };

    const ttlMs = refreshTokenTtl * 1000;
    await store.set(sessionId, record, ttlMs);

    return { sessionId, refreshToken: rawToken, expiresAt };
  },

  // ---------------------------------------------------------------------------
  // validateRefreshToken
  // ---------------------------------------------------------------------------

  /**
   * validateRefreshToken(rawRefreshToken)
   *
   * Finds a Session_Record by SHA-256 hash, checks isRevoked and expiresAt.
   *
   * - Hashes the raw token
   * - Scans store for matching refreshTokenHash via store.listAll()
   * - If not found: returns null
   * - If isRevoked: returns null
   * - If expiresAt < Date.now(): returns null
   * - Returns the Session_Record
   *
   * @param {string} rawRefreshToken
   * @returns {Promise<object|null>} Session_Record or null
   */
  async validateRefreshToken(rawRefreshToken) {
    if (!rawRefreshToken) return null;

    const store = this._getStore();
    const hash = CryptoUtils.hashToken(rawRefreshToken);

    const { records } = await store.listAll({});

    const record = records.find((r) => r.refreshTokenHash === hash);

    if (!record) return null;
    if (record.isRevoked) return null;
    if (record.expiresAt < Date.now()) return null;

    return record;
  },

  // ---------------------------------------------------------------------------
  // revokeSession
  // ---------------------------------------------------------------------------

  /**
   * revokeSession(sessionId)
   *
   * Marks a session as revoked within 100 ms (Req 2.5).
   *
   * - Fetches the session BEFORE revoking so we can blacklist the refresh
   *   token hash in the in-memory O(1) revocation set (VAPT #10).
   * - Calls store.markRevoked(sessionId) to persist the revocation flag.
   * - Adds session.refreshTokenHash to tokenRevocation.revokedHashes so
   *   the fast-path check in session-auth catches the token immediately,
   *   even before the store is consulted on the next request.
   * - Logs SESSION_REVOKED via auditLogger if available.
   *
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async revokeSession(sessionId, { reason, revokedBy, revokedAt } = {}) {
    const store = this._getStore();

    // VAPT #10 Gap 1: fetch the session first so we can blacklist its refresh
    // token hash. Do this before markRevoked() — after revocation the store
    // may return null / isRevoked:true, making the hash unavailable.
    let sessionSnapshot = null;
    try {
      sessionSnapshot = await store.get(sessionId);
    } catch { /* non-fatal — revocation still proceeds */ }

    await store.markRevoked(sessionId, { reason, revokedBy, revokedAt });

    // Blacklist the refresh token hash so the O(1) fast-path in session-auth
    // catches any reuse attempt immediately, without a store round-trip.
    if (sessionSnapshot && sessionSnapshot.refreshTokenHash) {
      try {
        const tokenRevocation = strapi.plugin('erp-session-manager').service('tokenRevocation');
        tokenRevocation.revokeByHash(sessionSnapshot.refreshTokenHash);
      } catch { /* non-fatal — isRevoked flag in store still blocks reuse */ }
    }

    const auditLogger = this._getAuditLogger();
    if (auditLogger && typeof auditLogger.log === 'function') {
      auditLogger.log({
        eventType: 'SESSION_REVOKED',
        sessionId,
        outcome: 'SUCCESS',
        metadata: { reason: reason || null },
      });
    }
  },

  // ---------------------------------------------------------------------------
  // revokeAllForUser
  // ---------------------------------------------------------------------------

  /**
   * revokeAllForUser(userId)
   *
   * Revokes all sessions for a user and returns the count.
   *
   * - Gets all sessions for user via store.getByUser(userId)
   * - Calls store.markRevoked() for each (with reason/metadata)
   * - Blacklists every session's refreshTokenHash (VAPT #10 Gap 1)
   * - Calls tokenRevocation.revokeAllUserTokens(userId) to set a per-user
   *   logout timestamp — any access JWT with iat < timestamp is immediately
   *   rejected by session-auth's isUserRevoked() check (VAPT #10 Gap 3).
   *   This closes the JWT-still-valid-after-logout window for content-API
   *   routes that fall through to Strapi's RBAC when no ERP session exists.
   * - Returns count
   *
   * @param {number} userId
   * @returns {Promise<number>} number of sessions revoked
   */
  async revokeAllForUser(userId) {
    const store      = this._getStore();
    const sessions   = await store.getByUser(userId);
    const revokedAt  = Date.now();

    // Blacklist refresh token hashes and mark sessions revoked concurrently
    let tokenRevocation = null;
    try {
      tokenRevocation = strapi.plugin('erp-session-manager').service('tokenRevocation');
    } catch { /* non-fatal */ }

    await Promise.all(
      sessions.map((session) => {
        // VAPT #10 Gap 1: blacklist each refresh token hash immediately
        if (tokenRevocation && session.refreshTokenHash) {
          try { tokenRevocation.revokeByHash(session.refreshTokenHash); } catch { /* non-fatal */ }
        }
        return store.markRevoked(session.sessionId, {
          reason:    'LOGOUT_ALL',
          revokedBy: userId,
          revokedAt,
        });
      })
    );

    // VAPT #10 Gap 3: set per-user logout timestamp so session-auth's
    // isUserRevoked() check rejects any JWT issued before this moment,
    // even on content-API routes that don't require an active ERP session.
    if (tokenRevocation) {
      try { tokenRevocation.revokeAllUserTokens(userId); } catch { /* non-fatal */ }
    }

    return sessions.length;
  },

  // ---------------------------------------------------------------------------
  // checkTimeouts
  // ---------------------------------------------------------------------------

  /**
   * checkTimeouts(sessionRecord)
   *
   * Returns { valid: bool, reason: 'IDLE'|'ABSOLUTE'|null }.
   *
   * - Checks idle: (Date.now() - sessionRecord.lastActive) > idleTimeout * 1000
   * - Checks absolute: (Date.now() - sessionRecord.issuedAt) > absoluteTimeout * 1000
   * - Absolute check takes priority over idle check
   * - If valid: returns { valid: true, reason: null }
   *
   * References: Req 3.4, Req 3.5
   *
   * @param {object} sessionRecord — Session_Record from store
   * @returns {{ valid: boolean, reason: 'IDLE'|'ABSOLUTE'|null }}
   */
  async checkTimeouts(sessionRecord) {
    const policy = await this._getPolicy();

    // Convert policy minutes/hours → milliseconds
    const idleTimeoutMs     = (policy.idleTimeoutMinutes    ?? 30)  * 60 * 1000;
    const absoluteTimeoutMs = (policy.absoluteTimeoutHours  ?? 8)   * 3600 * 1000;

    const now = Date.now();

    // Absolute timeout takes priority (Req 3.5)
    if (now - sessionRecord.issuedAt > absoluteTimeoutMs) {
      return { valid: false, reason: 'ABSOLUTE' };
    }

    // Idle timeout check (Req 3.4)
    if (now - sessionRecord.lastActive > idleTimeoutMs) {
      return { valid: false, reason: 'IDLE' };
    }

    return { valid: true, reason: null };
  },

  // ---------------------------------------------------------------------------
  // enforceMaxConcurrent
  // ---------------------------------------------------------------------------

  /**
   * enforceMaxConcurrent(userId)
   *
   * Counts active sessions and applies evictionPolicy (Req 4.2, Req 4.3).
   *
   * - Gets all sessions for user via store.getByUser(userId)
   * - Filters to active (not revoked, not expired)
   * - If count < maxConcurrent: returns (no action)
   * - If evictionPolicy === 'oldest-first': revokes session with earliest issuedAt
   * - If evictionPolicy === 'reject-new': throws an error with status 429
   *
   * @param {number} userId
   * @returns {Promise<void>}
   */
  async enforceMaxConcurrent(userId) {
    const policy = await this._getPolicy();
    const store  = this._getStore();

    const maxConcurrent  = policy.maxConcurrentSessions ?? 3;
    const evictionPolicy = policy.evictionPolicy ?? 'oldest-first';

    const allSessions = await store.getByUser(userId);
    const now = Date.now();

    // Filter to active sessions only (not revoked, not expired)
    const activeSessions = allSessions.filter(
      (s) => !s.isRevoked && s.expiresAt > now
    );

    if (activeSessions.length < maxConcurrent) {
      return; // Under the limit — no action needed
    }

    if (evictionPolicy === 'oldest-first') {
      // Revoke the session with the earliest issuedAt (Req 4.2).
      //
      // The explicit `null` seed keeps reduce() safe on an empty array. The
      // length guard above only proves `length >= maxConcurrent`, so a
      // misconfigured maxConcurrent <= 0 falls through here with zero active
      // sessions, where a seedless reduce throws "Reduce of empty array with
      // no initial value" — on the login path. That value is rejected by
      // PUT /policy (< 1) and by the AJV config schema (minimum: 1), and is
      // only reachable via an out-of-band write to erp_session_policy, since
      // `?? 3` above does not default a stored 0. Ties still keep the
      // earlier-seen session, so Req 4.2 selection is unchanged when non-empty.
      const oldest = activeSessions.reduce(
        (prev, curr) => (prev === null || curr.issuedAt < prev.issuedAt ? curr : prev),
        null
      );
      if (!oldest) {
        return; // Nothing active to evict — no session to revoke, no audit event
      }
      await store.markRevoked(oldest.sessionId, { reason: 'concurrent_limit' });

      const auditLogger = this._getAuditLogger();
      if (auditLogger && typeof auditLogger.log === 'function') {
        auditLogger.log({
          eventType: 'SESSION_EVICTED',
          userId,
          sessionId: oldest.sessionId,
          outcome: 'SUCCESS',
          metadata: { reason: 'max_concurrent_exceeded', evictionPolicy },
        });
      }
    } else if (evictionPolicy === 'reject-new') {
      // Reject the new login attempt (Req 4.3)
      const auditLogger = this._getAuditLogger();
      if (auditLogger && typeof auditLogger.log === 'function') {
        auditLogger.log({
          eventType: 'LOGIN_REJECTED_CONCURRENT_LIMIT',
          userId,
          outcome: 'FAILURE',
          metadata: { reason: 'max_concurrent_exceeded', evictionPolicy },
        });
      }

      const err = new Error(
        `Maximum concurrent sessions (${maxConcurrent}) reached. ` +
          'Please log out from another device before logging in again.'
      );
      err.status = 429;
      throw err;
    }
  },

  // ---------------------------------------------------------------------------
  // rotateRefreshToken
  // ---------------------------------------------------------------------------

  /**
   * rotateRefreshToken(sessionId)
   *
   * Generates a new refresh token, updates the hash in the store, and returns
   * the new raw token.
   *
   * - Generates new raw token via CryptoUtils.generateRefreshToken()
   * - Hashes it
   * - Gets current record from store
   * - Updates record.refreshTokenHash = newHash
   * - Re-saves via store.set()
   * - Returns new raw token
   *
   * @param {string} sessionId
   * @returns {Promise<string>} new raw refresh token
   */
  async rotateRefreshToken(sessionId) {
    const config = this._getConfig();
    const store = this._getStore();

    const newRawToken = CryptoUtils.generateRefreshToken();
    const newHash = CryptoUtils.hashToken(newRawToken);

    const record = await store.get(sessionId);
    if (!record) {
      const err = new Error(`Session not found: ${sessionId}`);
      err.status = 401;
      throw err;
    }

    record.refreshTokenHash = newHash;

    const refreshTokenTtl =
      config &&
      config.tokens &&
      typeof config.tokens.refreshTokenTtl === 'number'
        ? config.tokens.refreshTokenTtl
        : 28800;

    // Preserve the original expiresAt-based TTL rather than resetting the clock
    const remainingMs = Math.max(0, record.expiresAt - Date.now());
    const ttlMs = remainingMs > 0 ? remainingMs : refreshTokenTtl * 1000;

    await store.set(sessionId, record, ttlMs);

    return newRawToken;
  },
});
