'use strict';

const { sanitizeUserAgent, sanitizeIpAddress } = require('../utils/sanitize-ua');

/**
 * AuditLogger — writes Audit_Log_Entries to the erp_session_audit_log collection.
 *
 * All writes are fire-and-forget; failures are logged to strapi.log.error
 * and never thrown to the caller (Design §5.4).
 *
 * Supported event types (Req 6.1):
 *   LOGIN_SUCCESS, LOGIN_FAILURE, LOGOUT, TOKEN_REFRESH,
 *   SESSION_EXPIRED, SESSION_EVICTED, SESSION_REVOKED,
 *   TOKEN_REUSE_ATTEMPT, REVOKED_TOKEN_USE,
 *   ANOMALY_IP_CHANGE, ANOMALY_UA_CHANGE, ANOMALY_IMPOSSIBLE_TRAVEL,
 *   LOGIN_REJECTED_CONCURRENT_LIMIT,
 *   PASSWORD_CHANGED, PASSWORD_REJECTED
 */

const VALID_EVENT_TYPES = new Set([
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'LOGOUT',
  'TOKEN_REFRESH',
  'SESSION_EXPIRED',
  'SESSION_EVICTED',
  'SESSION_REVOKED',
  'TOKEN_REUSE_ATTEMPT',
  'REVOKED_TOKEN_USE',
  'ANOMALY_IP_CHANGE',
  'ANOMALY_UA_CHANGE',
  'ANOMALY_IMPOSSIBLE_TRAVEL',
  'LOGIN_REJECTED_CONCURRENT_LIMIT',
  'PASSWORD_CHANGED',
  'PASSWORD_REJECTED',
  'STEP_UP_SETUP_COMPLETE',
  'STEP_UP_SUCCESS',
  'STEP_UP_FAILURE',
  'STEP_UP_RATE_LIMITED',
  'STEP_UP_TOKEN_REUSE',
  'STEP_UP_IP_MISMATCH',
]);

module.exports = ({ strapi }) => ({
  /**
   * log({ eventType, userId, sessionId, ipAddress, userAgent, outcome, metadata })
   *
   * Fire-and-forget write to erp_session_audit_log (Req 6.3).
   * On write failure: logs to strapi.log.error only, never throws (Design §5.4).
   *
   * @param {object} entry
   * @param {string} entry.eventType  - One of the 15 supported event types (Req 6.1)
   * @param {number} [entry.userId]   - Strapi user ID (optional)
   * @param {string} [entry.sessionId] - Session ID, max 64 chars (optional)
   * @param {string} [entry.ipAddress] - IPv4 or IPv6, max 45 chars (optional)
   * @param {string} [entry.userAgent] - Full User-Agent string (optional)
   * @param {string} entry.outcome    - 'SUCCESS' or 'FAILURE' (required)
   * @param {object} [entry.metadata] - Arbitrary JSON metadata (optional)
   */
  log({ eventType, userId, sessionId, ipAddress, userAgent, outcome, metadata }) {
    if (!VALID_EVENT_TYPES.has(eventType)) {
      strapi.log.error(
        `[AuditLogger] Invalid eventType "${eventType}". Must be one of: ${[...VALID_EVENT_TYPES].join(', ')}`
      );
      return;
    }

    if (outcome !== 'SUCCESS' && outcome !== 'FAILURE') {
      strapi.log.error(
        `[AuditLogger] Invalid outcome "${outcome}". Must be "SUCCESS" or "FAILURE".`
      );
      return;
    }

    // Build the data payload — only include defined optional fields
    const data = {
      eventType,
      outcome,
      timestamp: new Date().toISOString(),
    };

    if (userId !== undefined && userId !== null) {
      data.userId = userId;
    }
    if (sessionId !== undefined && sessionId !== null) {
      data.sessionId = String(sessionId).slice(0, 64);
    }
    if (ipAddress !== undefined && ipAddress !== null) {
      data.ipAddress = sanitizeIpAddress(ipAddress);
    }
    if (userAgent !== undefined && userAgent !== null) {
      data.userAgent = sanitizeUserAgent(userAgent);
    }
    if (metadata !== undefined && metadata !== null) {
      data.metadata = metadata;
    }

    // Fire-and-forget: intentionally not awaited (Req 6.3)
    strapi
      .documents('plugin::erp-session-manager.erp-session-audit-log')
      .create({ data })
      .catch((err) => {
        strapi.log.error(
          `[AuditLogger] Failed to write audit log entry (eventType=${eventType}): ${err.message}`
        );
      });
  },

  /**
   * cleanup()
   *
   * Deletes audit log entries older than auditLog.retentionDays (Req 6.5).
   * Called by the daily cron job registered in bootstrap().
   */
  async cleanup() {
    let retentionDays;

    try {
      const pluginConfig = strapi.config.get('plugin::erp-session-manager');
      retentionDays =
        pluginConfig &&
        pluginConfig.auditLog &&
        typeof pluginConfig.auditLog.retentionDays === 'number'
          ? pluginConfig.auditLog.retentionDays
          : 90;
    } catch {
      retentionDays = 90;
    }

    const cutoffDate = new Date(
      Date.now() - retentionDays * 24 * 60 * 60 * 1000
    ).toISOString();

    try {
      const result = await strapi
        .documents('plugin::erp-session-manager.erp-session-audit-log')
        .deleteMany({
          filters: {
            timestamp: { $lt: cutoffDate },
          },
        });

      strapi.log.info(
        `[AuditLogger] Cleanup complete. Deleted entries older than ${retentionDays} days (cutoff: ${cutoffDate}). Count: ${result?.count ?? 'unknown'}`
      );
    } catch (err) {
      strapi.log.error(
        `[AuditLogger] Cleanup failed: ${err.message}`
      );
    }
  },
});
