'use strict';

const { checkCaptcha } = require('../utils/captcha-config'); // VAPT #20

/**
 * Password Validation Hook — intercepts users-permissions register and
 * changePassword controllers to enforce the configured password complexity
 * policy before the password reaches bcrypt hashing.
 *
 * Registered in bootstrap() by wrapping the users-permissions auth controller
 * (Design §11.4).
 *
 * References: Req 10.1–10.6, Design §11.4
 */

module.exports = ({ strapi }) => ({
  /**
   * register()
   * Called from bootstrap() to wrap the users-permissions auth controller.
   * Intercepts the register and changePassword actions.
   */
  register() {
    // Guard: users-permissions plugin must be installed (Req 14.5)
    const upPlugin = strapi.plugin('users-permissions');
    if (!upPlugin) {
      strapi.log.error(
        '[erp-session-manager] @strapi/plugin-users-permissions is not installed. ' +
        'Password validation features will be disabled.'
      );
      return;
    }

    // ── Wrap auth.register ────────────────────────────────────────────────────
    try {
      const authController = upPlugin.controller('auth');
      const originalRegister = authController.register.bind(authController);

      authController.register = async (ctx) => {
        const password = ctx.request.body && ctx.request.body.password;

        const rejected = this._validatePassword(ctx, password);
        if (rejected) {
          // _validatePassword already set ctx.status + ctx.body and logged the event
          return;
        }

        // VAPT #20 — verify image CAPTCHA before processing registration
        const captchaPassed = await checkCaptcha(ctx, strapi);
        if (!captchaPassed) {
          ctx.status = 400;
          ctx.body   = { data: null, error: { status: 400, name: 'ValidationError', message: 'CAPTCHA verification failed.' } };
          return;
        }

        // Password is valid and CAPTCHA passed — call the original register controller
        await originalRegister(ctx);

        // Log PASSWORD_CHANGED on a successful registration (Req 10.6)
        if (ctx.status >= 200 && ctx.status < 300) {
          this._logPasswordChanged(ctx);

          // VAPT #27: record the registration password to history so it
          // cannot be immediately reused on the first password change.
          const registeredUserId =
            (ctx.body && ctx.body.user && ctx.body.user.id) ||
            (ctx.body && ctx.body.data && ctx.body.data.user && ctx.body.data.user.id);
          if (registeredUserId) {
            await this._recordPasswordHistory(registeredUserId, 'content-api', password);
          }
        }
      };
    } catch (err) {
      strapi.log.error(
        `[erp-session-manager] Failed to wrap users-permissions auth.register: ${err.message}`
      );
    }

    // ── Wrap auth.changePassword ──────────────────────────────────────────────
    try {
      const authController = upPlugin.controller('auth');
      const originalChangePassword = authController.changePassword.bind(authController);

      authController.changePassword = async (ctx) => {
        const password = ctx.request.body && ctx.request.body.password;

        if (this._validatePassword(ctx, password)) {
          return;
        }

        const userId = ctx.state && ctx.state.user && ctx.state.user.id;
        if (userId && (await this._checkPasswordHistory(ctx, userId, 'content-api', password))) {
          return;
        }

        await originalChangePassword(ctx);

        if (ctx.status >= 200 && ctx.status < 300 && userId) {
          await this._postPasswordChangeRevocation(ctx, userId, password);
        }
      };
    } catch (err) {
      strapi.log.error(
        `[erp-session-manager] Failed to wrap users-permissions auth.changePassword: ${err.message}`
      );
    }
  },

  async _postPasswordChangeRevocation(ctx, userId, password) {
    let revokedCount = 0;
    try {
      const sessionService = strapi.plugin('erp-session-manager').service('session');
      revokedCount = await sessionService.revokeAllForUser(userId);
    } catch (err) {
      strapi.log.warn(
        `[erp-session-manager] Failed to revoke sessions on password change for user ${userId}: ${err.message}`
      );
    }

    // VAPT #27: record the new password to history on success (non-fatal)
    await this._recordPasswordHistory(userId, 'content-api', password);

    // Log PASSWORD_CHANGED on success (Req 10.6)
    this._logPasswordChanged(ctx, revokedCount);
  },

  /**
   * _validatePassword(ctx, password)
   *
   * Runs the PasswordValidator against the supplied password.
   * If validation fails, writes the HTTP 400 response and logs PASSWORD_REJECTED.
   *
   * @param {object} ctx      — Koa context
   * @param {string} password — plaintext password from request body
   * @returns {boolean} true if the password was rejected (caller should return early),
   *                    false if the password is valid (caller should proceed)
   */
  _validatePassword(ctx, password) {
    const passwordValidator = strapi
      .plugin('erp-session-manager')
      .service('passwordValidator');

    const pluginConfig = strapi.config.get('plugin::erp-session-manager');
    const passwordConfig = pluginConfig && pluginConfig.password
      ? pluginConfig.password
      : undefined;

    const result = passwordValidator.validate(password, passwordConfig);

    if (!result.valid) {
      // Log PASSWORD_REJECTED — deliberately omit the password value (Req 10.5)
      const auditLogger = strapi.plugin('erp-session-manager').service('auditLogger');
      const ip        = ctx.ip || ctx.request.ip || 'unknown';
      const userAgent = ctx.get('User-Agent') || '';
      const userId    = ctx.state && ctx.state.user && ctx.state.user.id;

      auditLogger.log({
        eventType: 'PASSWORD_REJECTED',
        userId,
        ipAddress: ip,
        userAgent,
        outcome:   'FAILURE',
        metadata:  {
          violations: result.violations.map((v) => ({ rule: v.rule, message: v.message })),
        },
      });

      // Return HTTP 400 with API_Envelope format (Req 10.3, Design §6.1)
      ctx.status = 400;
      ctx.body = {
        data:  null,
        meta:  {},
        error: {
          status:  400,
          name:    'ValidationError',
          message: 'Password does not meet complexity requirements.',
          details: { violations: result.violations },
        },
      };

      return true; // rejected
    }

    return false; // valid — proceed
  },

  /**
   * _checkPasswordHistory(ctx, userId, userType, plaintext)
   *
   * Checks whether `plaintext` matches any of the user's recent stored
   * password hashes. If a reuse is detected, writes a 400 response and
   * logs a PASSWORD_HISTORY_VIOLATION audit event.
   *
   * @param {object} ctx       — Koa context
   * @param {number} userId    — authenticated user ID
   * @param {string} userType  — 'admin' | 'content-api'
   * @param {string} plaintext — new password candidate
   * @returns {Promise<boolean>} true if rejected (caller should return),
   *                             false if the password is new (caller should proceed)
   */
  async _checkPasswordHistory(ctx, userId, userType, plaintext) {
    const pluginConfig    = strapi.config.get('plugin::erp-session-manager');
    const passwordConfig  = (pluginConfig && pluginConfig.password) || {};
    const historyCount    = typeof passwordConfig.passwordHistory === 'number'
      ? passwordConfig.passwordHistory
      : 5;

    if (historyCount <= 0) return false; // history disabled

    let reused = false;
    try {
      const passwordHistoryService = strapi
        .plugin('erp-session-manager')
        .service('passwordHistory');
      reused = await passwordHistoryService.checkReuse(userId, userType, plaintext, historyCount);
    } catch (err) {
      // Non-fatal: if history check fails, do not block the user
      strapi.log.warn(`[erp-session-manager] Password history check error (allowing change): ${err.message}`);
      return false;
    }

    if (!reused) return false;

    // Log PASSWORD_HISTORY_VIOLATION
    try {
      const auditLogger = strapi.plugin('erp-session-manager').service('auditLogger');
      auditLogger.log({
        eventType: 'PASSWORD_HISTORY_VIOLATION',
        userId,
        ipAddress: ctx.ip || ctx.request.ip || 'unknown',
        userAgent: ctx.get('User-Agent') || '',
        outcome:   'FAILURE',
        metadata:  { historyCount, userType },
      });
    } catch {
      // Audit log failure must never block the response
    }

    // Return 400 with violation details
    ctx.status = 400;
    ctx.body = {
      data:  null,
      meta:  {},
      error: {
        status:  400,
        name:    'ValidationError',
        message: 'Password does not meet complexity requirements.',
        details: {
          violations: [{
            rule:    'passwordHistory',
            message: `You cannot reuse any of your last ${historyCount} passwords.`,
          }],
        },
      },
    };

    return true; // rejected
  },

  /**
   * _recordPasswordHistory(userId, userType, plaintext)
   *
   * Records a new password hash in the history table. Non-fatal — any error
   * is logged as a warning and does not block the response.
   *
   * @param {number} userId    — user ID
   * @param {string} userType  — 'admin' | 'content-api'
   * @param {string} plaintext — the new password (plaintext — hashed by the service)
   * @returns {Promise<void>}
   */
  async _recordPasswordHistory(userId, userType, plaintext) {
    const pluginConfig   = strapi.config.get('plugin::erp-session-manager');
    const passwordConfig = (pluginConfig && pluginConfig.password) || {};
    const historyCount   = typeof passwordConfig.passwordHistory === 'number'
      ? passwordConfig.passwordHistory
      : 5;

    if (historyCount <= 0) return; // history disabled

    try {
      const passwordHistoryService = strapi
        .plugin('erp-session-manager')
        .service('passwordHistory');
      await passwordHistoryService.record(userId, userType, plaintext, historyCount);
    } catch (err) {
      strapi.log.warn(`[erp-session-manager] Failed to record password history for user ${userId}: ${err.message}`);
    }
  },

  /**
   * _logPasswordChanged(ctx, revokedCount)
   *
   * Logs a PASSWORD_CHANGED audit event after a successful password operation.
   * (Req 10.6)
   *
   * @param {object} ctx          — Koa context
   * @param {number} [revokedCount=0] — number of sessions revoked (VAPT #18)
   */
  _logPasswordChanged(ctx, revokedCount = 0) {
    try {
      const auditLogger = strapi.plugin('erp-session-manager').service('auditLogger');
      const ip        = ctx.ip || ctx.request.ip || 'unknown';
      const userAgent = ctx.get('User-Agent') || '';
      const userId    = ctx.state && ctx.state.user && ctx.state.user.id;

      // For registration the user is in the response body
      const responseUserId = userId ||
        (ctx.body && ctx.body.user && ctx.body.user.id) ||
        (ctx.body && ctx.body.data && ctx.body.data.user && ctx.body.data.user.id);

      auditLogger.log({
        eventType: 'PASSWORD_CHANGED',
        userId:    responseUserId,
        ipAddress: ip,
        userAgent,
        outcome:   'SUCCESS',
        metadata:  { sessionsRevoked: revokedCount },
      });
    } catch (err) {
      // Audit log failure must never block the response (Design §5.4)
      strapi.log.error(
        `[erp-session-manager] Failed to log PASSWORD_CHANGED audit event: ${err.message}`
      );
    }
  },
});
