'use strict';

/**
 * Admin Auth Hook — tracks Strapi admin panel login/logout sessions.
 *
 * Uses two complementary mechanisms:
 *   1. Koa middleware on POST /admin/login and POST /admin/logout to capture
 *      request context (IP, User-Agent) before/after the response.
 *   2. strapi.eventHub listeners for 'admin.auth.success', 'admin.auth.error',
 *      and 'admin.logout' to get the authenticated user object.
 *
 * Session records are stored in the same ISessionStore as content-API sessions,
 * with a `sessionType: 'admin'` field to distinguish them.
 *
 * References: Design §11.3 (extended for admin auth)
 * Gaps: G1 (known device), G6 (business hours), G18 (failed login threshold)
 */

const CryptoUtils = require('../utils/crypto');
const { checkAdminCaptcha } = require('../utils/captcha-config');

// G18: per-email failed login counters (15-min window)
const _failedLoginCounters = new Map(); // email → { count, resetAt }
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;

function readRecaptchaStream(res) {
  return new Promise((resolve) => {
    let data = '';
    res.on('data', (d) => { data += d; });
    res.on('end', () => {
      try { resolve(JSON.parse(data).score ?? 1); } catch { resolve(1); }
    });
  });
}

module.exports = ({ strapi }) => ({
  /**
   * register()
   * Called from bootstrap(). Registers the Koa middleware interceptors and
   * eventHub listeners for admin authentication events.
   */
  register() {
    this._registerMiddleware();
    this._registerEventListeners();
  },

  // ---------------------------------------------------------------------------
  // Koa middleware — captures request context (IP, UA) for admin auth routes
  // ---------------------------------------------------------------------------

  async _verifyRecaptcha(ctx, recaptcha) {
    if (!recaptcha.enabled || !recaptcha.secretKey) return true;
    const token = ctx.request.body?.['g-recaptcha-response'] || '';
    if (!token) return true;

    try {
      const https = require('node:https');
      const postData = `secret=${encodeURIComponent(recaptcha.secretKey)}&response=${encodeURIComponent(token)}`;
      const score = await new Promise((resolve) => {
        const req = https.request(
          {
            hostname: 'www.google.com',
            path: '/recaptcha/api/siteverify',
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Content-Length': Buffer.byteLength(postData),
            },
          },
          (res) => readRecaptchaStream(res).then(resolve)
        );
        req.on('error', () => resolve(1));
        req.write(postData);
        req.end();
      });
      const minScore = recaptcha.minScore ?? 0.5;
      return score >= minScore;
    } catch (err) {
      strapi.log.warn(`[erp-session-manager] reCAPTCHA check error: ${err.message}`);
      return true;
    }
  },

  async _applyTotpGateForUser(userId) {
    const stepUpConfigSvc   = strapi.plugin('erp-session-manager').service('stepUpConfig');
    const adminLoginTotpSvc = strapi.plugin('erp-session-manager').service('adminLoginTotp');
    const isEnabled         = await stepUpConfigSvc.getEnabled();

    if (!isEnabled) return;

    const adminUser    = await strapi.service('admin::user').findOne(userId);
    const isSuperAdmin = (adminUser?.roles || []).some((r) => r.code === 'strapi-super-admin');

    if (isSuperAdmin) {
      const stepUpService = strapi.plugin('erp-session-manager').service('stepUp');
      const status        = await stepUpService.getStatus(userId);

      adminLoginTotpSvc.clear(userId);

      // status.provisioned is CONFIRMED-only: a secret that was provisioned but
      // never verified (user closed the QR screen) reports false, so this login
      // shows the QR again instead of demanding a code they cannot generate.
      if (status.provisioned) {
        adminLoginTotpSvc.require(userId);
      } else {
        let setupData = null;
        try {
          // Re-displays the existing unconfirmed secret when there is one, so a
          // QR already scanned on a previous attempt keeps working.
          setupData = await stepUpService.getOrCreateSetupPayload(userId);
        } catch (provisionErr) {
          strapi.log.warn(`[erp-session-manager] TOTP provision error for user ${userId}: ${provisionErr.message}`);
        }
        adminLoginTotpSvc.requireSetup(userId, setupData);
      }

      strapi.log.debug(`[erp-session-manager] TOTP gate set synchronously for user ${userId} (${status.provisioned ? 'verify' : 'setup'} required)`);
    }
  },

  async _syncTotpGate(ctx) {
    if (ctx.status < 200 || ctx.status >= 300) return;
    try {
      const token = ctx.body?.data?.token || ctx.body?.token;
      if (!token) return;

      const decoded = require('jsonwebtoken').decode(token);
      const rawId   = decoded && (decoded.userId ?? decoded.id);
      const userId  = rawId ? Number(rawId) : null;
      if (!userId) return;

      await this._applyTotpGateForUser(userId);
    } catch (err) {
      strapi.log.warn(`[erp-session-manager] TOTP gate sync setup error: ${err.message}`);
    }
  },

  async _handleAdminLoginRoute(ctx, next) {
    const ip = ctx.ip || ctx.request.ip || 'unknown';
    const userAgent = ctx.get('User-Agent') || '';

    const pluginConfig = strapi.config.get('plugin::erp-session-manager') || {};
    const recaptcha = pluginConfig.recaptcha || {};

    const recaptchaPassed = await this._verifyRecaptcha(ctx, recaptcha);
    if (!recaptchaPassed) {
      ctx.status = 400;
      ctx.body = { data: null, error: { status: 400, name: 'ValidationError', message: 'reCAPTCHA verification failed.' } };
      return;
    }

    try {
      const passed = await checkAdminCaptcha(ctx, strapi);
      if (!passed) {
        ctx.status = 400;
        ctx.body   = { data: null, error: { status: 400, name: 'ValidationError', message: 'CAPTCHA verification failed.' } };
        return;
      }
    } catch (err) {
      strapi.log.warn(`[erp-session-manager] Admin SVG CAPTCHA check error: ${err.message}`);
    }

    const requestId = Date.now().toString();
    this._pendingContext.set('__latest_login__', { ip, userAgent, requestId, ts: Date.now() });

    await next();

    await this._syncTotpGate(ctx);

    this._cleanupPendingContext();
  },

  async _handleAdminCaptchaProtectedRoutes(ctx, next) {
    try {
      const passed = await checkAdminCaptcha(ctx, strapi);
      if (!passed) {
        ctx.status = 400;
        ctx.body   = { data: null, error: { status: 400, name: 'ValidationError', message: 'CAPTCHA verification failed.' } };
        return;
      }
    } catch (err) {
      strapi.log.warn(`[erp-session-manager] Admin SVG CAPTCHA check error: ${err.message}`);
    }
    await next();
  },

  async _postAdminPasswordChange(userId, newPassword, ctx) {
    if (ctx.status < 200 || ctx.status >= 300 || !userId) return;

    try {
      const sessionService = strapi.plugin('erp-session-manager').service('session');
      await sessionService.revokeAllForUser(userId);
      strapi.log.debug(`[erp-session-manager] Sessions revoked for user ${userId} after admin password change`);
    } catch (err) {
      strapi.log.warn(`[erp-session-manager] Failed to revoke sessions after admin password change for user ${userId}: ${err.message}`);
    }

    if (newPassword) {
      try {
        const pwHook = strapi.plugin('erp-session-manager').service('passwordValidationHook');
        await pwHook._recordPasswordHistory(userId, 'admin', newPassword);
      } catch (err) {
        strapi.log.warn(`[erp-session-manager] Failed to record admin password history for user ${userId}: ${err.message}`);
      }
    }
  },

  async _handleAdminPasswordChange(ctx, next) {
    const hasCurrentPassword = !!(ctx.request.body && ctx.request.body.currentPassword);
    if (!hasCurrentPassword) {
      return next();
    }

    const userId      = ctx.state?.user?.id;
    const newPassword = ctx.request.body?.password;

    if (newPassword && userId) {
      try {
        const pwHook = strapi.plugin('erp-session-manager').service('passwordValidationHook');
        const rejected = await pwHook._checkPasswordHistory(ctx, userId, 'admin', newPassword);
        if (rejected) return;
      } catch (err) {
        strapi.log.warn(`[erp-session-manager] Admin password history check error (allowing change): ${err.message}`);
      }
    }

    await next();

    await this._postAdminPasswordChange(userId, newPassword, ctx);
  },

  async _handleAdminLogoutRoute(ctx, next) {
    const ip = ctx.ip || ctx.request.ip || 'unknown';
    const userAgent = ctx.get('User-Agent') || '';
    const userId = ctx.state?.user?.id;

    const rawAdminToken = (ctx.get('Authorization') || '')
      .replace(/^Bearer\s+/i, '')
      .trim();

    if (userId) {
      this._pendingContext.set(`logout_${userId}`, { ip, userAgent, ts: Date.now() });
    }

    await next();

    if (ctx.status >= 200 && ctx.status < 300 && rawAdminToken) {
      try {
        const adminTokenBlacklist = strapi.plugin('erp-session-manager').service('adminTokenBlacklist');
        await adminTokenBlacklist.revokeToken(rawAdminToken, userId, 'LOGOUT');
      } catch (err) {
        strapi.log.warn(`[erp-session-manager] Admin token revocation on logout failed: ${err.message}`);
      }
    }

    this._cleanupPendingContext();
  },

  _registerMiddleware() {
    this._pendingContext = new Map();

    strapi.server.use(async (ctx, next) => {
      const method = ctx.method ? ctx.method.toUpperCase() : '';
      const path = ctx.path;

      if (method === 'POST' && path === '/admin/login') {
        return this._handleAdminLoginRoute(ctx, next);
      }

      if (method === 'POST' && (path === '/admin/forgot-password' || path === '/admin/reset-password' || path === '/admin/register-admin')) {
        return this._handleAdminCaptchaProtectedRoutes(ctx, next);
      }

      if (method === 'PUT' && path === '/admin/users/me') {
        return this._handleAdminPasswordChange(ctx, next);
      }

      if (method === 'POST' && path === '/admin/logout') {
        return this._handleAdminLogoutRoute(ctx, next);
      }

      return next();
    });
  },

  _cleanupPendingContext() {
    const now = Date.now();
    for (const [key, val] of this._pendingContext.entries()) {
      if (now - val.ts > 10000) {
        this._pendingContext.delete(key);
      }
    }
  },

  // ---------------------------------------------------------------------------
  // EventHub listeners — receive user object from Strapi's auth events
  // ---------------------------------------------------------------------------

  _registerEventListeners() {
    // Successful admin login
    strapi.eventHub.on('admin.auth.success', async ({ user }) => {
      try {
        await this._onAdminLoginSuccess(user);
      } catch (err) {
        strapi.log.error(`[erp-session-manager] Admin login hook error: ${err.message}`);
      }
    });

    // Failed admin login
    strapi.eventHub.on('admin.auth.error', async ({ error }) => {
      try {
        await this._onAdminLoginFailure(error);
      } catch (err) {
        strapi.log.error(`[erp-session-manager] Admin login failure hook error: ${err.message}`);
      }
    });

    // Admin logout
    strapi.eventHub.on('admin.logout', async ({ user }) => {
      try {
        await this._onAdminLogout(user);
      } catch (err) {
        strapi.log.error(`[erp-session-manager] Admin logout hook error: ${err.message}`);
      }
    });
  },

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  async _onAdminLoginSuccess(user) {
    const sessionService = strapi.plugin('erp-session-manager').service('session');
    const auditLogger    = strapi.plugin('erp-session-manager').service('auditLogger');
    const adminAlertSvc  = strapi.plugin('erp-session-manager').service('adminAlert');
    const policyService  = strapi.plugin('erp-session-manager').service('policy');

    // Retrieve the request context captured by the middleware
    const ctx = this._pendingContext.get('__latest_login__') || {};
    this._pendingContext.delete('__latest_login__');

    const ip        = ctx.ip || 'unknown';
    const userAgent = ctx.userAgent || '';

    // Fetch live policy once for use by all features below
    let policy = {};
    try { policy = await policyService.getPolicy(); } catch { /* use defaults */ }

    // NOTE: TOTP gate (adminLoginTotpSvc.clear / require / requireSetup) is handled
    // synchronously in _registerMiddleware()'s after-next() phase BEFORE the login
    // response is sent.  Do NOT touch adminLoginTotpSvc here — it would race against
    // and erase the synchronously-set gate.

    // G1: Known device tracking ─────────────────────────────────────────────
    let deviceHash = null;
    try {
      deviceHash = CryptoUtils.hashToken(`${userAgent}:${ip.slice(0, 8)}`);

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
            userId:       user.id,
            deviceHash,
            userAgent,
            firstSeenIp:  ip,
            firstSeenAt:  now,
            lastSeenAt:   now,
            trusted:      false,
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
    } catch (err) {
      strapi.log.warn(`[erp-session-manager] Known device tracking error: ${err.message}`);
    }
    // ────────────────────────────────────────────────────────────────────────

    // G6: Business hours alert ───────────────────────────────────────────────
    try {
      const utcHour = new Date().getUTCHours();
      const utcMinutes = new Date().getUTCMinutes();
      const istDecimal = (utcHour + 5 + (utcMinutes + 30) / 60) % 24;
      const hourIST = Math.floor(istDecimal);

      const start = policy.businessHoursStart ?? 9;
      const end   = policy.businessHoursEnd   ?? 18;

      if (hourIST < start || hourIST >= end) {
        adminAlertSvc.sendAnomalyAlert({
          userId:    user.id,
          userEmail: user.email,
          reason:    'OUT_OF_HOURS_LOGIN',
          metadata:  { hourIST, businessHoursStart: start, businessHoursEnd: end },
        });
      }
    } catch (err) {
      strapi.log.warn(`[erp-session-manager] Business hours check error: ${err.message}`);
    }
    // ────────────────────────────────────────────────────────────────────────

    // Enforce concurrent session limit for admin users
    try {
      await sessionService.enforceMaxConcurrent(user.id);
    } catch (err) {
      if (err.status === 429) {
        // Log but don't block — admin login uses Strapi's own session management
        strapi.log.warn(`[erp-session-manager] Admin user ${user.id} exceeded concurrent session limit`);
      }
    }

    // Create a session record for this admin login (pass deviceHash for G13)
    const { sessionId, expiresAt } = await sessionService.createSession({
      userId:      user.id,
      ipAddress:   ip,
      userAgent,
      deviceHash,
      sessionType: 'admin',
    });

    // Store sessionId keyed by userId for logout correlation
    this._pendingContext.set(`session_${user.id}`, { sessionId, ts: Date.now() });

    // NOTE: TOTP login gate (adminLoginTotpSvc.require / requireSetup) is now
    // set SYNCHRONOUSLY in _registerMiddleware()'s after-next() phase, before
    // the 200 response is sent to the browser.  Doing it here (in the async
    // event handler) caused a race condition where the first admin API calls
    // slipped through the gate.  The event handler is intentionally left without
    // gate-setting code — the middleware handles it reliably.

    // Audit log
    auditLogger.log({
      eventType: 'LOGIN_SUCCESS',
      userId:    user.id,
      sessionId,
      ipAddress: ip,
      userAgent,
      outcome:   'SUCCESS',
      metadata:  { sessionType: 'admin', expiresAt, email: user.email },
    });

    strapi.log.debug(`[erp-session-manager] Admin session created for user ${user.email} (${sessionId.slice(0, 8)})`);
  },

  async _onAdminLoginFailure(error) {
    const auditLogger   = strapi.plugin('erp-session-manager').service('auditLogger');
    const adminAlertSvc = strapi.plugin('erp-session-manager').service('adminAlert');
    const policyService = strapi.plugin('erp-session-manager').service('policy');

    const ctx = this._pendingContext.get('__latest_login__') || {};
    this._pendingContext.delete('__latest_login__');

    auditLogger.log({
      eventType: 'LOGIN_FAILURE',
      ipAddress: ctx.ip || 'unknown',
      userAgent: ctx.userAgent || '',
      outcome:   'FAILURE',
      metadata:  { sessionType: 'admin', error: error && error.message },
    });

    // G18: Failed login threshold alert ──────────────────────────────────────
    try {
      const email = (error && error.email) || ctx.email || 'unknown';
      const now   = Date.now();
      let entry   = _failedLoginCounters.get(email);

      if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: now + FAILED_LOGIN_WINDOW_MS };
      }
      entry.count += 1;
      _failedLoginCounters.set(email, entry);

      let policy = {};
      try { policy = await policyService.getPolicy(); } catch { /* use defaults */ }
      const threshold = policy.alertAfterFailedAttempts ?? 5;

      if (entry.count >= threshold) {
        adminAlertSvc.sendAnomalyAlert({
          userId:    null,
          userEmail: email,
          reason:    'FAILED_LOGIN_THRESHOLD',
          metadata:  { count: entry.count, threshold, ip: ctx.ip },
        });
        // Reset counter after alert
        _failedLoginCounters.delete(email);
      }
    } catch (err) {
      strapi.log.warn(`[erp-session-manager] Failed login threshold check error: ${err.message}`);
    }
    // ────────────────────────────────────────────────────────────────────────
  },

  async _onAdminLogout(user) {
    const sessionService    = strapi.plugin('erp-session-manager').service('session');
    const auditLogger       = strapi.plugin('erp-session-manager').service('auditLogger');
    const adminLoginTotpSvc = strapi.plugin('erp-session-manager').service('adminLoginTotp');

    // Always clear any pending TOTP flag on logout so a re-login starts fresh
    adminLoginTotpSvc.clear(user.id);

    // Get request context from middleware
    const reqCtx = this._pendingContext.get(`logout_${user.id}`) || {};
    this._pendingContext.delete(`logout_${user.id}`);

    // Get the session ID we stored at login
    const sessionEntry = this._pendingContext.get(`session_${user.id}`);
    const sessionId = sessionEntry && sessionEntry.sessionId;
    if (sessionEntry) {
      this._pendingContext.delete(`session_${user.id}`);
    }

    // Revoke the session if we have it
    if (sessionId) {
      try {
        await sessionService.revokeSession(sessionId);
      } catch (err) {
        strapi.log.warn(`[erp-session-manager] Failed to revoke admin session ${sessionId}: ${err.message}`);
      }
    }

    auditLogger.log({
      eventType: 'LOGOUT',
      userId:    user.id,
      sessionId: sessionId || null,
      ipAddress: reqCtx.ip || 'unknown',
      userAgent: reqCtx.userAgent || '',
      outcome:   'SUCCESS',
      metadata:  { sessionType: 'admin', email: user.email },
    });
  },
});
