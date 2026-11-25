'use strict';

/**
 * Admin Config Controller
 *
 * Endpoints (Design §6.2):
 *   GET /erp-session-manager/config             — resolved plugin config with secrets redacted (Req 16.10)
 *   GET /erp-session-manager/config/captcha     — current CAPTCHA config (VAPT #20)
 *   PUT /erp-session-manager/config/captcha     — update CAPTCHA config (VAPT #20)
 *
 * References: Req 16.10, Design §6.2, VAPT #20
 */

const { envelope, envelopeError, setRequestId } = require('../../utils/response');
const { redactSecrets }                          = require('../../config/schema');
const { getCaptchaConfig, saveCaptchaConfig }    = require('../../utils/captcha-config');

module.exports = ({ strapi }) => ({
  async getConfig(ctx) {
    setRequestId(ctx);
    const config  = strapi.config.get('plugin::erp-session-manager');
    const redacted = redactSecrets(config);
    ctx.body = envelope(redacted);
  },

  /**
   * GET /erp-session-manager/config/captcha
   * Returns current CAPTCHA settings (admin-panel-saved or plugin defaults).
   */
  async getCaptchaConfig(ctx) {
    setRequestId(ctx);
    try {
      const cfg = await getCaptchaConfig(strapi);
      ctx.body = envelope(cfg);
    } catch (err) {
      ctx.status = 500;
      ctx.body   = envelopeError(500, 'InternalServerError', err.message);
    }
  },

  /**
   * PUT /erp-session-manager/config/captcha
   * Update CAPTCHA settings. Persisted to strapi.store — no restart needed.
   *
   * Body: { enabled?: boolean, enforceForContentApi?: boolean, ttlSeconds?: number }
   * Omitting a field preserves the existing value.
   */
  async updateCaptchaConfig(ctx) {
    setRequestId(ctx);
    try {
      const { enabled, enforceForContentApi, enforceForAdminPanel, ttlSeconds } = ctx.request.body || {};

      // Validate inputs
      if (enabled !== undefined && typeof enabled !== 'boolean') {
        ctx.status = 400;
        ctx.body   = envelopeError(400, 'ValidationError', 'enabled must be a boolean');
        return;
      }
      if (enforceForContentApi !== undefined && typeof enforceForContentApi !== 'boolean') {
        ctx.status = 400;
        ctx.body   = envelopeError(400, 'ValidationError', 'enforceForContentApi must be a boolean');
        return;
      }
      if (enforceForAdminPanel !== undefined && typeof enforceForAdminPanel !== 'boolean') {
        ctx.status = 400;
        ctx.body   = envelopeError(400, 'ValidationError', 'enforceForAdminPanel must be a boolean');
        return;
      }
      if (ttlSeconds !== undefined) {
        const n = Number(ttlSeconds);
        if (!Number.isFinite(n) || n < 60 || n > 3600) {
          ctx.status = 400;
          ctx.body   = envelopeError(400, 'ValidationError', 'ttlSeconds must be a number between 60 and 3600');
          return;
        }
      }

      // Merge with existing config — omitted fields preserve current value
      const existing = await getCaptchaConfig(strapi);
      const next = {
        enabled:              enabled              ?? existing.enabled              ?? false,
        enforceForContentApi: enforceForContentApi ?? existing.enforceForContentApi ?? true,
        enforceForAdminPanel: enforceForAdminPanel ?? existing.enforceForAdminPanel ?? true,
        ttlSeconds:           ttlSeconds           ?? existing.ttlSeconds           ?? 300,
      };

      await saveCaptchaConfig(strapi, next);
      ctx.body = envelope(next);
    } catch (err) {
      ctx.status = 500;
      ctx.body   = envelopeError(500, 'InternalServerError', err.message);
    }
  },
});
