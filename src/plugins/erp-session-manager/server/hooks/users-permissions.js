'use strict';

const { buildCookieOptions } = require('../utils/cookie-options');
const CryptoUtils             = require('../utils/crypto');
const { checkCaptcha }        = require('../utils/captcha-config'); // VAPT #20

/**
 * Users-Permissions Hooks — intercepts login and logout events from
 * @strapi/plugin-users-permissions to attach session management.
 *
 * Registered in bootstrap() by wrapping the users-permissions auth controller
 * (Design §11.3, Design §5.8).
 *
 */
async function handleCallbackPostLogin(ctx, strapi, onLoginSuccess) {
  if (ctx.status >= 200 && ctx.status < 300 && ctx.body && ctx.body.jwt) {
    const user = ctx.body.user || ctx.state.user;
    if (user) {
      try {
        await onLoginSuccess(ctx, user);
      } catch (err) {
        if (err.status === 429) {
          ctx.status = 429;
          ctx.body = {
            data: null, meta: {},
            error: {
              status: 429,
              name: 'TooManyRequestsError',
              message: err.message,
              details: { reason: 'max_concurrent_exceeded' },
            },
          };
        } else {
          strapi.log.error(`[erp-session-manager] Login hook error: ${err.message}`);
        }
      }
    }
  } else if (ctx.status >= 400) {
    try {
      const auditLogger = strapi.plugin('erp-session-manager').service('auditLogger');
      auditLogger.log({
        eventType: 'LOGIN_FAILURE',
        ipAddress: ctx.ip || ctx.request.ip,
        userAgent: ctx.get('User-Agent'),
        outcome: 'FAILURE',
      });
    } catch {
      // audit log failure must never block response
    }
  }
}

module.exports = ({ strapi }) => ({
  /**
   * register()
   * Called from bootstrap() to wrap the users-permissions auth controller.
   * Intercepts the callback (login) and logout actions.
   */
  register() {
    // Guard: users-permissions plugin must be installed (Req 14.5)
    const upPlugin = strapi.plugin('users-permissions');
    if (!upPlugin) {
      strapi.log.error(
        '[erp-session-manager] @strapi/plugin-users-permissions is not installed. ' +
        'Session management features will be disabled.'
      );
      return;
    }

    // Wrap the auth.callback controller (handles POST /api/auth/local)
    try {
      const authController = upPlugin.controller('auth');
      const originalCallback = authController.callback.bind(authController);

      authController.callback = async (ctx) => {
        const captchaPassed = await checkCaptcha(ctx, strapi);
        if (!captchaPassed) {
          ctx.status = 400;
          ctx.body   = { data: null, error: { status: 400, name: 'ValidationError', message: 'CAPTCHA verification failed.' } };
          return;
        }

        await originalCallback(ctx);

        await handleCallbackPostLogin(ctx, strapi, (c, u) => this.onLoginSuccess(c, u));
      };
    } catch (err) {
      strapi.log.error(`[erp-session-manager] Failed to wrap users-permissions auth.callback: ${err.message}`);
    }

    // VAPT #20 — Wrap auth.forgotPassword to enforce image CAPTCHA
    try {
      const authController        = upPlugin.controller('auth');
      const originalForgotPassword = authController.forgotPassword.bind(authController);

      authController.forgotPassword = async (ctx) => {
        const captchaPassed = await checkCaptcha(ctx, strapi);
        if (!captchaPassed) {
          ctx.status = 400;
          ctx.body   = { data: null, error: { status: 400, name: 'ValidationError', message: 'CAPTCHA verification failed.' } };
          return;
        }
        await originalForgotPassword(ctx);
      };
    } catch (err) {
      strapi.log.error(
        `[erp-session-manager] Failed to wrap users-permissions auth.forgotPassword: ${err.message}`
      );
    }
  },

  async _trackContentApiDevice(user, ip, userAgent) {
    try {
      const adminAlertSvc = strapi.plugin('erp-session-manager').service('adminAlert');
      const policyService = strapi.plugin('erp-session-manager').service('policy');
      let policy = {};
      try { policy = await policyService.getPolicy(); } catch { /* use defaults */ }

      const deviceHash = CryptoUtils.hashToken(`${userAgent}:${ip.slice(0, 8)}`);

      const existing = await strapi.documents('plugin::erp-session-manager.erp-known-device').findFirst({
        filters: { userId: { $eq: user.id }, deviceHash: { $eq: deviceHash } },
      });

      if (existing) {
        await strapi.documents('plugin::erp-session-manager.erp-known-device').update({
          documentId: existing.documentId,
          data: { lastSeenAt: new Date().toISOString() },
        });
      } else {
        const now = new Date().toISOString();
        await strapi.documents('plugin::erp-session-manager.erp-known-device').create({
          data: {
            userId:      user.id,
            deviceHash,
            userAgent,
            firstSeenIp: ip,
            firstSeenAt: now,
            lastSeenAt:  now,
            trusted:     false,
          },
        });

        if (policy.alertNewDevice !== false) {
          adminAlertSvc.sendNewDeviceAlert({
            userId:    user.id,
            userEmail: user.email,
            deviceHash,
            ip,
            userAgent,
          });
        }
      }
      return deviceHash;
    } catch (err) {
      strapi.log.warn(`[erp-session-manager] Content-API device tracking error: ${err.message}`);
      return null;
    }
  },

  /**
   * onLoginSuccess(ctx, user)
   * Called after a successful login. Creates a server-side session and sets the
   * erp_rt cookie with all required security attributes (Req 8.1–8.5).
   *
   * @param {object} ctx  — Koa context
   * @param {object} user — authenticated Strapi user
   */
  async onLoginSuccess(ctx, user) {
    const sessionService = strapi.plugin('erp-session-manager').service('session');
    const auditLogger   = strapi.plugin('erp-session-manager').service('auditLogger');
    const pluginConfig  = strapi.config.get('plugin::erp-session-manager');

    const ip        = ctx.ip || ctx.request.ip || 'unknown';
    const userAgent = ctx.get('User-Agent') || '';

    // 1. Enforce concurrent session limit (Req 4.1–4.5)
    await sessionService.enforceMaxConcurrent(user.id);

    // 1b. VAPT #24 — Known device tracking for content-API users.
    const deviceHash = await this._trackContentApiDevice(user, ip, userAgent);

    // 2 & 3. Create session (generates refresh token internally; pass deviceHash for G13)
    const { sessionId, refreshToken, expiresAt } = await sessionService.createSession({
      userId:      user.id,
      ipAddress:   ip,
      userAgent,
      deviceHash,
      sessionType: 'content',
    });

    // 4. Set erp_rt cookie with all OWASP-required attributes (Req 8.1–8.5)
    const cookieName = (pluginConfig && pluginConfig.cookies && pluginConfig.cookies.name)
      ? pluginConfig.cookies.name
      : 'erp_rt';

    const refreshTokenTtl = (pluginConfig && pluginConfig.tokens && pluginConfig.tokens.refreshTokenTtl)
      ? pluginConfig.tokens.refreshTokenTtl
      : 28800;

    // Warn if not running over HTTPS (Req 8.7)
    const proto = ctx.get('X-Forwarded-Proto') || ctx.protocol;
    if (proto !== 'https' && process.env.NODE_ENV === 'production') {
      strapi.log.warn(
        '[erp-session-manager] Secure cookie attribute will not be effective: ' +
        'server does not appear to be running behind HTTPS.'
      );
    }

    ctx.cookies.set(cookieName, refreshToken, buildCookieOptions(pluginConfig, refreshTokenTtl * 1000));

    // 5. Audit log LOGIN_SUCCESS (Req 6.1)
    auditLogger.log({
      eventType: 'LOGIN_SUCCESS',
      userId:    user.id,
      sessionId,
      ipAddress: ip,
      userAgent,
      outcome:   'SUCCESS',
      metadata:  { expiresAt },
    });

    // 6. VAPT #12 — set content-API TOTP pending flag if the user has TOTP provisioned.
    //    Any subsequent content-API request will be blocked by session-auth.js until
    //    the user verifies their TOTP code via POST /api/erp-session/step-up/verify-login-totp.
    const enforceForContentApi = pluginConfig?.stepUp?.enforceForContentApi === true;
    if (enforceForContentApi) {
      try {
        const stepUpSvc           = strapi.plugin('erp-session-manager').service('stepUp');
        const contentLoginTotpSvc = strapi.plugin('erp-session-manager').service('contentLoginTotp');
        const { provisioned }      = await stepUpSvc.getStatus(user.id);
        if (provisioned) {
          contentLoginTotpSvc.require(user.id);
        }
      } catch (err) {
        // Non-fatal — login still succeeds; TOTP gate degrades gracefully on error
        strapi.log.warn(`[erp-session-manager] Content-API TOTP gate setup error: ${err.message}`);
      }
    }
  },

  /**
   * onLogout(ctx)
   * Called from the logout controller. Revokes the session and clears the cookie.
   *
   * @param {object} ctx — Koa context
   */
  async onLogout(ctx) {
    const sessionService = strapi.plugin('erp-session-manager').service('session');
    const auditLogger   = strapi.plugin('erp-session-manager').service('auditLogger');
    const pluginConfig  = strapi.config.get('plugin::erp-session-manager');

    const cookieName = (pluginConfig && pluginConfig.cookies && pluginConfig.cookies.name)
      ? pluginConfig.cookies.name
      : 'erp_rt';

    const ip        = ctx.ip || ctx.request.ip || 'unknown';
    const userAgent = ctx.get('User-Agent') || '';
    const userId    = ctx.state && ctx.state.user && ctx.state.user.id;

    // 1. Read erp_rt cookie
    const rawToken = ctx.cookies.get(cookieName);

    let sessionId = null;
    if (rawToken) {
      // 2. Validate and find session
      const sessionRecord = await sessionService.validateRefreshToken(rawToken);
      if (sessionRecord) {
        sessionId = sessionRecord.sessionId;
        // 3. Revoke session
        await sessionService.revokeSession(sessionId);
      }
    }

    // 4. Clear cookie (Max-Age=0)
    ctx.cookies.set(cookieName, '', buildCookieOptions(pluginConfig, 0));

    // 5. Audit log LOGOUT
    auditLogger.log({
      eventType: 'LOGOUT',
      userId,
      sessionId,
      ipAddress: ip,
      userAgent,
      outcome:   'SUCCESS',
    });
  },
});
