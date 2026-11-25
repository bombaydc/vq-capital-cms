'use strict';

/**
 * ContentLoginTotp controller — content-API endpoint for post-login TOTP verification.
 *
 * Flow:
 *   1. User logs in via POST /api/auth/local → JWT returned
 *   2. session-auth.js sees contentLoginTotp.isPending(userId) → 403 { totpPending: true }
 *   3. Client POSTs TOTP code here → code verified via stepUp.verifySetup()
 *   4. On success: contentLoginTotp.clear(userId) → subsequent requests pass
 *
 * Route: POST /api/erp-session/step-up/verify-login-totp
 * Auth:  Strapi JWT middleware validates Bearer token and sets ctx.state.user.
 *        This controller returns 401 if ctx.state.user is absent.
 *
 * VAPT #12 — Content-API TOTP enforcement
 */

module.exports = ({ strapi }) => ({
  /**
   * verifyLoginTotp(ctx)
   *
   * Validates the TOTP code for the authenticated user and clears the
   * content-API pending gate on success.
   *
   * @param {import('@strapi/types').Context} ctx
   */
  async verifyLoginTotp(ctx) {
    const userId = ctx.state && ctx.state.user && ctx.state.user.id;

    if (!userId) {
      ctx.status = 401;
      ctx.body = {
        data: null, meta: {},
        error: { status: 401, name: 'UnauthorizedError', message: 'Authentication required.' },
      };
      return;
    }

    const { code } = ctx.request.body || {};

    if (!code || typeof code !== 'string') {
      ctx.status = 422;
      ctx.body = {
        data: null, meta: {},
        error: { status: 422, name: 'ValidationError', message: 'TOTP code is required.' },
      };
      return;
    }
    // VAPT #15: enforce 6-digit numeric format — reject anything that isn't exactly 6 digits
    if (!/^\d{6}$/.test(code)) {
      ctx.status = 422;
      ctx.body = {
        data: null, meta: {},
        error: { status: 422, name: 'ValidationError', message: 'TOTP code must be exactly 6 digits.' },
      };
      return;
    }

    const stepUpSvc           = strapi.plugin('erp-session-manager').service('stepUp');
    const contentLoginTotpSvc = strapi.plugin('erp-session-manager').service('contentLoginTotp');
    const auditLogger         = strapi.plugin('erp-session-manager').service('auditLogger');

    const ip        = ctx.ip || ctx.request.ip || 'unknown';
    const userAgent = ctx.get('User-Agent') || '';

    // Verify TOTP code against the user's provisioned secret
    const result = await stepUpSvc.verifySetup(userId, code);

    if (!result.valid) {
      try {
        auditLogger.log({
          eventType: 'STEP_UP_FAILURE',
          userId,
          ipAddress: ip,
          userAgent,
          outcome:  'FAILURE',
          metadata: { context: 'content_api_login_totp', reason: result.reason },
        });
      } catch { /* audit log failure must never block the response */ }

      ctx.status = 422;
      ctx.body = {
        data: null, meta: {},
        error: {
          status: 422,
          name:   'ValidationError',
          message: 'Invalid TOTP code.',
          details: { reason: result.reason },
        },
      };
      return;
    }

    // Clear the pending gate — user is now fully authenticated
    contentLoginTotpSvc.clear(userId);

    try {
      auditLogger.log({
        eventType: 'STEP_UP_SUCCESS',
        userId,
        ipAddress: ip,
        userAgent,
        outcome:  'SUCCESS',
        metadata: { context: 'content_api_login_totp' },
      });
    } catch { /* non-fatal */ }

    ctx.status = 200;
    ctx.body = { data: { verified: true }, meta: {} };
  },
});
