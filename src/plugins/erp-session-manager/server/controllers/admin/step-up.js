'use strict';

/**
 * Admin Step-Up Controller
 *
 * Endpoints (Design §15.5):
 *   GET  /erp-session-manager/step-up/status          — provisioning status for current user
 *   GET  /erp-session-manager/step-up/setup           — get TOTP provisioning URI + Base32 secret
 *   POST /erp-session-manager/step-up/setup/verify    — confirm TOTP setup with a test code
 *   POST /erp-session-manager/step-up/challenge       — exchange TOTP code for step-up token
 *   POST /erp-session-manager/step-up/regenerate      — regenerate TOTP secret (requires current code)
 *
 * All endpoints require admin::isAuthenticatedAdmin policy.
 * No Super Admin restriction — any admin user may manage their own TOTP secret.
 *
 * References: Req 18.1.4–18.1.5, Req 18.2.1, Req 18.7, Design §15.5
 */

const { envelope, envelopeError, setRequestId } = require('../../utils/response');

module.exports = ({ strapi }) => ({
  /**
   * GET /erp-session-manager/step-up/status
   * Returns provisioning status for the current authenticated admin user.
   */
  async getStatus(ctx) {
    setRequestId(ctx);
    const userId = ctx.state?.user?.id;
    if (!userId) {
      ctx.status = 401;
      ctx.body = envelopeError(401, 'UnauthorizedError', 'Authentication required.');
      return;
    }

    const stepUpService = strapi.plugin('erp-session-manager').service('stepUp');
    const status = await stepUpService.getStatus(userId);
    ctx.body = envelope(status);
  },

  /**
   * GET /erp-session-manager/step-up/setup
   * Generates a new TOTP secret and returns the provisioning URI + Base32 secret.
   * If a secret already exists it is replaced (pending re-verification via /setup/verify).
   */
  async getSetup(ctx) {
    setRequestId(ctx);
    const userId = ctx.state?.user?.id;
    if (!userId) {
      ctx.status = 401;
      ctx.body = envelopeError(401, 'UnauthorizedError', 'Authentication required.');
      return;
    }

    const stepUpService = strapi.plugin('erp-session-manager').service('stepUp');
    const result = await stepUpService.provisionSecret(userId);
    ctx.body = envelope(result);
  },

  /**
   * POST /erp-session-manager/step-up/setup/verify
   * Confirms TOTP setup by validating a test code against the provisioned secret.
   * Body: { totpCode: "123456" }
   */
  async verifySetup(ctx) {
    setRequestId(ctx);
    const userId = ctx.state?.user?.id;
    if (!userId) {
      ctx.status = 401;
      ctx.body = envelopeError(401, 'UnauthorizedError', 'Authentication required.');
      return;
    }

    const { totpCode } = ctx.request.body || {};
    if (!totpCode || typeof totpCode !== 'string') {
      ctx.status = 400;
      ctx.body = envelopeError(400, 'ValidationError', 'totpCode is required.');
      return;
    }
    // VAPT #15: enforce 6-digit numeric format — reject anything that isn't exactly 6 digits
    if (!/^\d{6}$/.test(totpCode)) {
      ctx.status = 400;
      ctx.body = envelopeError(400, 'ValidationError', 'totpCode must be exactly 6 digits.');
      return;
    }

    const stepUpService     = strapi.plugin('erp-session-manager').service('stepUp');
    const adminLoginTotpSvc = strapi.plugin('erp-session-manager').service('adminLoginTotp');
    const result = await stepUpService.verifySetup(userId, totpCode);

    if (!result.valid) {
      ctx.status = 401;
      ctx.body = envelopeError(401, 'UnauthorizedError', 'Invalid TOTP code.', { reason: result.reason });
      return;
    }

    // If this verification completes a post-login forced setup, unlock the admin panel.
    if (adminLoginTotpSvc.isSetupRequired(userId)) {
      adminLoginTotpSvc.clear(userId);
    }

    ctx.body = envelope({ verified: true });
  },

  /**
   * POST /erp-session-manager/step-up/challenge
   * Exchanges a valid TOTP code for a short-lived step-up token.
   * Body: { totpCode: "123456" }
   */
  async challenge(ctx) {
    setRequestId(ctx);
    const userId = ctx.state?.user?.id;
    if (!userId) {
      ctx.status = 401;
      ctx.body = envelopeError(401, 'UnauthorizedError', 'Authentication required.');
      return;
    }

    const { totpCode } = ctx.request.body || {};
    if (!totpCode || typeof totpCode !== 'string') {
      ctx.status = 400;
      ctx.body = envelopeError(400, 'ValidationError', 'totpCode is required.');
      return;
    }
    // VAPT #15: enforce 6-digit numeric format
    if (!/^\d{6}$/.test(totpCode)) {
      ctx.status = 400;
      ctx.body = envelopeError(400, 'ValidationError', 'totpCode must be exactly 6 digits.');
      return;
    }

    const stepUpService = strapi.plugin('erp-session-manager').service('stepUp');
    const clientIp = ctx.ip || ctx.request.ip || 'unknown';
    const result = await stepUpService.issueStepUpToken(userId, clientIp, totpCode);

    if (result.error) {
      const statusCode = result.status || 401;
      const errorName = statusCode === 429 ? 'TooManyRequestsError' : 'UnauthorizedError';
      const message = statusCode === 429
        ? 'Too many failed TOTP attempts. Please try again later.'
        : result.error === 'NOT_PROVISIONED'
          ? 'TOTP has not been set up for this account. Please complete setup first.'
          : 'Invalid TOTP code.';

      ctx.status = statusCode;
      ctx.body = envelopeError(statusCode, errorName, message, {
        reason:            result.error,
        remainingAttempts: result.remainingAttempts,
        resetAt:           result.resetAt,
      });
      return;
    }

    ctx.body = envelope({ token: result.token });
  },

  /**
   * POST /erp-session-manager/step-up/admin-login-totp
   *
   * Verifies the TOTP code submitted on the post-login challenge screen.
   * On success, clears the pendingTotp flag so the admin panel becomes accessible.
   *
   * This endpoint is called by src/admin/app.js after the user enters their
   * authenticator code following a successful password login.
   *
   * Body: { totpCode: "123456" }
   */
  async adminLoginTotp(ctx) {
    setRequestId(ctx);
    const userId = ctx.state?.user?.id;
    if (!userId) {
      ctx.status = 401;
      ctx.body = envelopeError(401, 'UnauthorizedError', 'Authentication required.');
      return;
    }

    const { totpCode } = ctx.request.body || {};
    if (!totpCode || typeof totpCode !== 'string') {
      ctx.status = 400;
      ctx.body = envelopeError(400, 'ValidationError', 'totpCode is required.');
      return;
    }
    // VAPT #15: enforce 6-digit numeric format
    if (!/^\d{6}$/.test(totpCode)) {
      ctx.status = 400;
      ctx.body = envelopeError(400, 'ValidationError', 'totpCode must be exactly 6 digits.');
      return;
    }

    const adminLoginTotpSvc = strapi.plugin('erp-session-manager').service('adminLoginTotp');

    // If nothing is pending (e.g. called redundantly), succeed silently
    if (!adminLoginTotpSvc.isPending(userId)) {
      ctx.body = envelope({ verified: true });
      return;
    }

    const stepUpService = strapi.plugin('erp-session-manager').service('stepUp');
    const auditLogger   = strapi.plugin('erp-session-manager').service('auditLogger');
    const clientIp      = ctx.ip || ctx.request.ip || 'unknown';
    const userAgent     = ctx.get('User-Agent') || '';

    // Re-use issueStepUpToken to validate the code and enforce rate-limiting
    const result = await stepUpService.issueStepUpToken(userId, clientIp, totpCode);

    if (result.error) {
      const statusCode = result.status || 401;
      const errorName  = statusCode === 429 ? 'TooManyRequestsError' : 'UnauthorizedError';
      const message    = statusCode === 429
        ? 'Too many failed attempts. Please try again later.'
        : result.error === 'NOT_PROVISIONED'
          ? 'Authenticator not set up for this account.'
          : 'Invalid authenticator code. Please try again.';

      auditLogger.log({
        eventType: 'STEP_UP_FAILURE',
        userId,
        ipAddress: clientIp,
        userAgent,
        outcome:   'FAILURE',
        metadata:  { context: 'admin_login_totp', reason: result.error },
      });

      ctx.status = statusCode;
      ctx.body   = envelopeError(statusCode, errorName, message, {
        reason:            result.error,
        remainingAttempts: result.remainingAttempts,
        resetAt:           result.resetAt,
      });
      return;
    }

    // TOTP verified — clear the login gate
    adminLoginTotpSvc.clear(userId);

    auditLogger.log({
      eventType: 'STEP_UP_SUCCESS',
      userId,
      ipAddress: clientIp,
      userAgent,
      outcome:   'SUCCESS',
      metadata:  { context: 'admin_login_totp' },
    });

    strapi.log.debug(
      `[erp-session-manager] Login TOTP verified for admin user ${userId}`
    );

    ctx.body = envelope({ verified: true });
  },

  /**
   * GET /erp-session-manager/step-up/global-config
   * Returns the current global enabled/disabled state (persisted across restarts).
   */
  async getGlobalConfig(ctx) {
    setRequestId(ctx);
    const stepUpConfigSvc = strapi.plugin('erp-session-manager').service('stepUpConfig');
    const enabled = await stepUpConfigSvc.getEnabled();
    ctx.body = envelope({ enabled });
  },

  /**
   * POST /erp-session-manager/step-up/global-config
   * Enables or disables TOTP step-up globally. Persists across restarts.
   * Body: { enabled: true | false }
   */
  async setGlobalEnabled(ctx) {
    setRequestId(ctx);
    const { enabled } = ctx.request.body || {};
    if (typeof enabled !== 'boolean') {
      ctx.status = 400;
      ctx.body = envelopeError(400, 'ValidationError', 'enabled (boolean) is required.');
      return;
    }

    const stepUpConfigSvc = strapi.plugin('erp-session-manager').service('stepUpConfig');
    await stepUpConfigSvc.setEnabled(enabled);

    const auditLogger = strapi.plugin('erp-session-manager').service('auditLogger');
    auditLogger.log({
      eventType:  enabled ? 'STEP_UP_SUCCESS' : 'STEP_UP_FAILURE',
      userId:     ctx.state?.user?.id,
      ipAddress:  ctx.ip || 'unknown',
      userAgent:  ctx.get('User-Agent') || '',
      outcome:    'SUCCESS',
      metadata:   { action: 'global_config_change', enabled },
    });

    ctx.body = envelope({ enabled });
  },

  /**
   * POST /erp-session-manager/step-up/remove
   * Removes the current user's TOTP secret (disables TOTP for this account).
   */
  async removeSecret(ctx) {
    setRequestId(ctx);
    const userId = ctx.state?.user?.id;
    if (!userId) {
      ctx.status = 401;
      ctx.body = envelopeError(401, 'UnauthorizedError', 'Authentication required.');
      return;
    }

    try {
      const existing = await strapi
        .documents('plugin::erp-session-manager.erp-step-up-secret')
        .findFirst({ filters: { userId } });

      if (existing) {
        await strapi
          .documents('plugin::erp-session-manager.erp-step-up-secret')
          .delete({ documentId: existing.documentId });
      }
    } catch (err) {
      ctx.status = 500;
      ctx.body = envelopeError(500, 'InternalError', 'Failed to remove TOTP secret.');
      return;
    }

    const auditLogger = strapi.plugin('erp-session-manager').service('auditLogger');
    auditLogger.log({
      eventType: 'STEP_UP_SETUP_COMPLETE',
      userId,
      ipAddress: ctx.ip || 'unknown',
      userAgent: ctx.get('User-Agent') || '',
      outcome:   'SUCCESS',
      metadata:  { action: 'secret_removed' },
    });

    ctx.body = envelope({ removed: true });
  },

  /**
   * POST /erp-session-manager/step-up/regenerate
   * Regenerates the TOTP secret after verifying the current code.
   * Body: { totpCode: "123456" }
   */
  async regenerate(ctx) {
    setRequestId(ctx);
    const userId = ctx.state?.user?.id;
    if (!userId) {
      ctx.status = 401;
      ctx.body = envelopeError(401, 'UnauthorizedError', 'Authentication required.');
      return;
    }

    const { totpCode } = ctx.request.body || {};
    if (!totpCode || typeof totpCode !== 'string') {
      ctx.status = 400;
      ctx.body = envelopeError(400, 'ValidationError', 'totpCode is required to regenerate the secret.');
      return;
    }

    const stepUpService = strapi.plugin('erp-session-manager').service('stepUp');
    const result = await stepUpService.regenerateSecret(userId, totpCode);

    if (result.error) {
      ctx.status = 401;
      ctx.body = envelopeError(401, 'UnauthorizedError', 'Invalid TOTP code. Cannot regenerate secret.', { reason: result.error });
      return;
    }

    ctx.body = envelope(result);
  },
});
