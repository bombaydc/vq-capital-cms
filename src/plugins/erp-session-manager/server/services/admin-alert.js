'use strict';

/**
 * AdminAlertService — sends security alert emails to administrators.
 *
 * Two alert types:
 *   sendNewDeviceAlert — fired on first login from an unrecognised device (G1)
 *   sendAnomalyAlert   — fired on security anomalies and threshold breaches (G5/G18)
 *
 * Both methods are fully wrapped in try/catch.  SMTP failures are non-fatal:
 * they are logged at warn level and never propagate to the caller.
 *
 * If the Strapi email plugin is not installed or not configured, both methods
 * log a warning and return immediately.
 *
 * The ADMIN_ALERT_EMAIL environment variable overrides the recipient address.
 * When not set, the alert is sent to the user's own email address.
 *
 * References: Gap G5 (email alerting), G1 (new device), G18 (failed login threshold)
 */

module.exports = ({ strapi }) => {
  /**
   * Check that the Strapi email plugin is available and has a send method.
   * @returns {object|null} email service or null
   */
  function _getEmailService() {
    try {
      const emailPlugin = strapi.plugin('email');
      if (!emailPlugin) return null;
      const svc = emailPlugin.service('email');
      if (typeof svc?.send !== 'function') return null;
      return svc;
    } catch {
      return null;
    }
  }

  return {
    /**
     * sendNewDeviceAlert({ userId, userEmail, deviceHash, ip, userAgent })
     *
     * Sends an email when an admin logs in from a device not seen before.
     *
     * @param {object} params
     * @param {number} params.userId
     * @param {string} params.userEmail
     * @param {string} params.deviceHash
     * @param {string} params.ip
     * @param {string} params.userAgent
     * @returns {Promise<void>}
     */
    async sendNewDeviceAlert({ userId, userEmail, deviceHash, ip, userAgent }) {
      try {
        const emailSvc = _getEmailService();
        if (!emailSvc) {
          strapi.log.warn(
            '[admin-alert] Email plugin not available — new device alert skipped ' +
            `(userId=${userId}, ip=${ip})`
          );
          return;
        }

        const to = process.env.ADMIN_ALERT_EMAIL || userEmail;
        const timestamp = new Date().toISOString();

        await emailSvc.send({
          to,
          subject: '[ERP Security] New device login detected',
          text: [
            `A login was detected from a new device for your administrator account.`,
            ``,
            `User:        ${userEmail} (ID: ${userId})`,
            `Timestamp:   ${timestamp}`,
            `IP Address:  ${ip}`,
            `User-Agent:  ${userAgent}`,
            `Device Hash: ${deviceHash}`,
            ``,
            `If this was not you, please contact your system administrator immediately.`,
          ].join('\n'),
        });
      } catch (err) {
        strapi.log.warn(
          `[admin-alert] sendNewDeviceAlert failed (non-fatal): ${err.message}`
        );
      }
    },

    /**
     * sendAnomalyAlert({ userId, userEmail, reason, metadata })
     *
     * Sends an email for security anomalies such as impossible travel,
     * out-of-hours login, or repeated failed login attempts.
     *
     * @param {object} params
     * @param {number|null} params.userId
     * @param {string|null} params.userEmail
     * @param {string}      params.reason    — e.g. 'FAILED_LOGIN_THRESHOLD'
     * @param {object}      params.metadata
     * @returns {Promise<void>}
     */
    async sendAnomalyAlert({ userId, userEmail, reason, metadata }) {
      try {
        const emailSvc = _getEmailService();
        if (!emailSvc) {
          strapi.log.warn(
            `[admin-alert] Email plugin not available — anomaly alert skipped ` +
            `(reason=${reason}, userId=${userId})`
          );
          return;
        }

        const to = process.env.ADMIN_ALERT_EMAIL || userEmail;
        if (!to) {
          strapi.log.warn(
            `[admin-alert] No recipient for anomaly alert (reason=${reason}, userId=${userId})`
          );
          return;
        }

        const timestamp = new Date().toISOString();

        await emailSvc.send({
          to,
          subject: `[ERP Security] Anomaly detected: ${reason}`,
          text: [
            `A security anomaly was detected on your administrator account.`,
            ``,
            `Reason:    ${reason}`,
            `User:      ${userEmail || 'unknown'} (ID: ${userId ?? 'unknown'})`,
            `Timestamp: ${timestamp}`,
            `Details:   ${JSON.stringify(metadata || {}, null, 2)}`,
            ``,
            `If this was not you, please contact your system administrator immediately.`,
          ].join('\n'),
        });
      } catch (err) {
        strapi.log.warn(
          `[admin-alert] sendAnomalyAlert failed (non-fatal): ${err.message}`
        );
      }
    },
  };
};
