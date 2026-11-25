'use strict';

/**
 * Captcha Controller — public challenge endpoint.
 *
 * Endpoint: GET /api/erp-session/captcha/challenge[?context=admin]
 *
 * Returns an SVG image CAPTCHA challenge and a signed challengeToken.
 * No authentication required — this endpoint must be accessible before login.
 *
 * Query param:
 *   context=admin  — checks enforceForAdminPanel (admin panel auth pages)
 *   (omitted)      — checks enforceForContentApi (content-API endpoints)
 *
 * VAPT #20 — Missing CAPTCHA (Low, CVSS 2.6).
 * References: OWASP Testing Guide OTG-AUTHN-003
 */

const { generateCaptchaChallenge } = require('../../utils/captcha');
const { getCaptchaConfig }         = require('../../utils/captcha-config');
const { envelope, setRequestId }   = require('../../utils/response');

module.exports = ({ strapi }) => ({
  /**
   * GET /api/erp-session/captcha/challenge[?context=admin]
   *
   * When CAPTCHA is disabled/exempt: returns { enabled: false, captchaImage: null, challengeToken: null }
   * When CAPTCHA is active:          returns { enabled: true, captchaImage: "<svg>…", challengeToken: "…" }
   *
   * The caller should:
   *   1. Render captchaImage as inline SVG in the login/register form
   *   2. Ask the user to type the characters shown
   *   3. Submit captchaToken + captchaAnswer alongside the auth request body
   */
  async getChallenge(ctx) {
    setRequestId(ctx);
    try {
      const cfg     = await getCaptchaConfig(strapi);
      const context = ctx.query && ctx.query.context; // 'admin' or undefined

      // Determine whether CAPTCHA is active for this context
      const active = cfg.enabled && (
        context === 'admin'
          ? cfg.enforceForAdminPanel !== false
          : cfg.enforceForContentApi !== false
      );

      if (!active) {
        ctx.body = envelope({ enabled: false, captchaImage: null, challengeToken: null });
        return;
      }

      const secret = (strapi.config.get('server.app.keys') || [])[0] || 'captcha-fallback-secret';
      const ttlMs  = (cfg.ttlSeconds || 300) * 1000;
      const { captchaImage, challengeToken } = generateCaptchaChallenge(secret, ttlMs);

      ctx.body = envelope({ enabled: true, captchaImage, challengeToken });
    } catch (err) {
      strapi.log.warn(`[erp-session-manager] CAPTCHA challenge generation error: ${err.message}`);
      ctx.status = 500;
      ctx.body   = envelope({ enabled: false, captchaImage: null, challengeToken: null });
    }
  },
});
