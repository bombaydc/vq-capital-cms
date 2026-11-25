'use strict';

/**
 * RateLimit_Middleware — intercepts auth endpoints and enforces per-IP rate limits.
 *
 * Applies to (POST unless noted):
 *   POST /api/auth/local                           — login
 *   POST /api/auth/local/register                  — registration
 *   POST /api/erp-session/refresh                  — token refresh
 *   PUT  /admin/users/me (+ currentPassword)        — admin password change (VAPT #4)
 *   POST /api/auth/change-password                 — API user password change (VAPT #4)
 *
 *   VAPT #9 — P1: Password recovery endpoints (unauthenticated, abuse-prone)
 *   POST /api/auth/forgot-password                 — email enumeration / inbox spam
 *   POST /api/auth/reset-password                  — reset-token brute force
 *   POST /api/auth/send-email-confirmation          — email resend abuse
 *   POST /admin/forgot-password                    — admin email enumeration
 *   POST /admin/reset-password                     — admin reset-token brute force
 *
 *   VAPT #9 — P2: Sensitive / computationally expensive endpoints
 *   GET  /erp-session-manager/audit-logs/export    — expensive DB scan + CSV stream
 *   POST /erp-session-manager/store/test-redis     — fires external network request
 *   POST /erp-session-manager/step-up/regenerate   — cycles TOTP secret
 *   POST /erp-session-manager/step-up/admin-login-totp — post-login TOTP gate
 *   POST /erp-session-manager/step-up/setup/verify — TOTP setup verification
 *   GET  /api/auth/callback/:provider              — OAuth redirect / open-redirect probing
 *
 * Returns HTTP 429 with Retry-After header when limit is exceeded (Req 11.3).
 * Logs audit events via AuditLogger (Req 11.5).
 *
 * For change-password paths: after next(), if the response is 4xx (wrong old
 * password), emits PASSWORD_CHANGE_FAILURE to make failed attempts visible to
 * security monitoring.
 *
 * References: Req 11.1–11.5, Design §2.2; VAPT #9
 */

// POST-only rate-limited paths (exact match)
const RATE_LIMITED_POST_PATHS = new Set([
  '/api/auth/local',
  '/api/auth/local/register',
  '/api/erp-session/refresh',
  '/api/auth/change-password',
  // VAPT #9 — P1: password recovery
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/send-email-confirmation',
  '/admin/forgot-password',
  '/admin/reset-password',
  // VAPT #9 — P2: sensitive authenticated endpoints
  '/erp-session-manager/store/test-redis',
  '/erp-session-manager/step-up/regenerate',
  '/erp-session-manager/step-up/admin-login-totp',
  '/erp-session-manager/step-up/setup/verify',
]);

// GET-only rate-limited paths (exact match)
const RATE_LIMITED_GET_PATHS = new Set([
  '/erp-session-manager/audit-logs/export',
]);

/**
 * Returns true when the request is a password-change attempt.
 * Handles both the Strapi 5 admin route (PUT /admin/users/me with currentPassword)
 * and the users-permissions API route (POST /api/auth/change-password).
 */
function isChangePasswordRequest(method, path, body) {
  // Strapi 5 admin: PUT /admin/users/me — only when body contains currentPassword
  if (method === 'PUT' && path === '/admin/users/me' && body && body.currentPassword) {
    return true;
  }
  // users-permissions API change-password
  if (method === 'POST' && path === '/api/auth/change-password') {
    return true;
  }
  return false;
}

/**
 * Path → rate-limit rule.
 *
 * `configKey` is the key read from pluginConfig.rateLimiting and is NOT always
 * the same as `endpointKey`: /api/erp-session/refresh deliberately reuses the
 * login limit *settings* while counting against its own separate counter.
 * `defaults` is the fallback used when that config key is absent.
 */
const RATE_LIMIT_RULES = new Map([
  ['/api/auth/local',                              { endpointKey: 'login',            configKey: 'login',            defaults: { windowMs: 900000,  maxAttempts: 10 } }],
  ['/api/auth/local/register',                     { endpointKey: 'register',         configKey: 'register',         defaults: { windowMs: 3600000, maxAttempts: 5  } }],
  ['/api/erp-session/refresh',                     { endpointKey: 'refresh',          configKey: 'login',            defaults: { windowMs: 900000,  maxAttempts: 10 } }],
  // VAPT #9 P1 — both admin and API forgot-password share the same tight limit
  ['/api/auth/forgot-password',                    { endpointKey: 'forgotPassword',   configKey: 'forgotPassword',   defaults: { windowMs: 900000,  maxAttempts: 3  } }],
  ['/admin/forgot-password',                       { endpointKey: 'forgotPassword',   configKey: 'forgotPassword',   defaults: { windowMs: 900000,  maxAttempts: 3  } }],
  // VAPT #9 P1 — reset-token brute force protection
  ['/api/auth/reset-password',                     { endpointKey: 'resetPassword',    configKey: 'resetPassword',    defaults: { windowMs: 900000,  maxAttempts: 5  } }],
  ['/admin/reset-password',                        { endpointKey: 'resetPassword',    configKey: 'resetPassword',    defaults: { windowMs: 900000,  maxAttempts: 5  } }],
  // VAPT #9 P1 — email resend abuse
  ['/api/auth/send-email-confirmation',            { endpointKey: 'emailConfirm',     configKey: 'emailConfirm',     defaults: { windowMs: 3600000, maxAttempts: 3  } }],
  // VAPT #9 P2 — expensive CSV export
  ['/erp-session-manager/audit-logs/export',       { endpointKey: 'auditExport',      configKey: 'auditExport',      defaults: { windowMs: 3600000, maxAttempts: 5  } }],
  // VAPT #9 P2 — external network call
  ['/erp-session-manager/store/test-redis',        { endpointKey: 'redisTest',        configKey: 'redisTest',        defaults: { windowMs: 3600000, maxAttempts: 10 } }],
  // VAPT #9 P2 — TOTP secret cycling
  ['/erp-session-manager/step-up/regenerate',      { endpointKey: 'stepUpRegenerate', configKey: 'stepUpRegenerate', defaults: { windowMs: 3600000, maxAttempts: 3  } }],
  // VAPT #9 P2 — TOTP verification endpoints (shared counter)
  ['/erp-session-manager/step-up/admin-login-totp', { endpointKey: 'stepUpVerify',    configKey: 'stepUpVerify',     defaults: { windowMs: 900000,  maxAttempts: 5  } }],
  ['/erp-session-manager/step-up/setup/verify',    { endpointKey: 'stepUpVerify',     configKey: 'stepUpVerify',     defaults: { windowMs: 900000,  maxAttempts: 5  } }],
]);

// These three are not plain path lookups: change-password is derived from method
// + body, the OAuth callback is a prefix match, and the fallback guards against a
// path being added to the RATE_LIMITED_* sets above without a rule here.
const CHANGE_PASSWORD_RULE = { endpointKey: 'changePassword', configKey: 'changePassword', defaults: { windowMs: 900000, maxAttempts: 5  } };
const OAUTH_CALLBACK_RULE  = { endpointKey: 'oauthCallback',  configKey: 'oauthCallback',  defaults: { windowMs: 900000, maxAttempts: 20 } };
const DEFAULT_RULE         = { endpointKey: 'login',          configKey: 'login',          defaults: { windowMs: 900000, maxAttempts: 10 } };

/**
 * Resolves which rate-limit rule applies to a request.
 *
 * Precedence matches the original if/else chain. change-password is tested first
 * because it is the only rule keyed on something other than the path (PUT
 * /admin/users/me is not in RATE_LIMIT_RULES at all); the two paths it can match
 * do not appear in the table, so hoisting it above the lookup is behaviourally
 * identical. The OAuth prefix is tested after the exact-match table for the same
 * reason — its paths cannot collide with any table entry.
 *
 * @param {{path: string, changePwd: boolean, isOAuthCallback: boolean}} req
 * @returns {{endpointKey: string, configKey: string, defaults: object}}
 */
function resolveRateLimitRule({ path, changePwd, isOAuthCallback }) {
  if (changePwd) return CHANGE_PASSWORD_RULE;

  const rule = RATE_LIMIT_RULES.get(path);
  if (rule) return rule;

  if (isOAuthCallback) return OAUTH_CALLBACK_RULE;

  return DEFAULT_RULE;
}

function handleRateLimitExceeded(ctx, strapi, status, path, ip, changePwd) {
  const retryAfterSeconds = Math.ceil((status.resetAt - Date.now()) / 1000);

  try {
    const auditLogger = strapi.plugin('erp-session-manager').service('auditLogger');
    auditLogger.log({
      eventType: changePwd ? 'PASSWORD_CHANGE_FAILURE' : 'LOGIN_FAILURE',
      ipAddress: ip,
      outcome:   'FAILURE',
      metadata:  { reason: 'RATE_LIMITED', endpoint: path, retryAfterSeconds },
    });
  } catch {
    // audit log failure must never block the response
  }

  ctx.status = 429;
  ctx.set('Retry-After', String(retryAfterSeconds));
  ctx.body = {
    data:  null,
    meta:  {},
    error: {
      status:  429,
      name:    'TooManyRequestsError',
      message: `Too many attempts. Try again in ${retryAfterSeconds} seconds.`,
      details: { retryAfterSeconds },
    },
  };
}

function handleFailedPasswordChangeAudit(ctx, strapi, ip, path) {
  try {
    const auditLogger = strapi.plugin('erp-session-manager').service('auditLogger');
    const userId = ctx.state?.user?.id;
    auditLogger.log({
      eventType: 'PASSWORD_CHANGE_FAILURE',
      userId,
      ipAddress: ip,
      userAgent: ctx.get('User-Agent') || '',
      outcome:   'FAILURE',
      metadata:  {
        reason:   'INVALID_OLD_PASSWORD',
        endpoint: path,
        status:   ctx.status,
      },
    });
  } catch {
    // non-fatal
  }
}

module.exports = function createRateLimitMiddleware(config, { strapi }) {
  return async function rateLimitMiddleware(ctx, next) {
    const method = ctx.method ? ctx.method.toUpperCase() : '';
    const path   = ctx.path;
    const body   = ctx.request?.body;

    const changePwd         = isChangePasswordRequest(method, path, body);
    const isRateLimitedPost = method === 'POST' && RATE_LIMITED_POST_PATHS.has(path);
    const isRateLimitedGet  = method === 'GET'  && RATE_LIMITED_GET_PATHS.has(path);
    const isOAuthCallback   = method === 'GET'  && path.startsWith('/api/auth/callback/');

    if (!changePwd && !isRateLimitedPost && !isRateLimitedGet && !isOAuthCallback) {
      return next();
    }

    const pluginConfig = strapi.config.get('plugin::erp-session-manager');
    const rateLimiting = pluginConfig?.rateLimiting || {};

    const rule        = resolveRateLimitRule({ path, changePwd, isOAuthCallback });
    const endpointKey = rule.endpointKey;
    const limitConfig = rateLimiting[rule.configKey] || rule.defaults;

    const ip          = ctx.ip || ctx.request?.ip || 'unknown';
    const rateLimiter = strapi.plugin('erp-session-manager').service('rateLimiter');

    const status = rateLimiter.check(endpointKey, ip, limitConfig);

    if (!status.allowed) {
      return handleRateLimitExceeded(ctx, strapi, status, path, ip, changePwd);
    }

    await rateLimiter.increment(endpointKey, ip, limitConfig);

    await next();

    if (changePwd && ctx.status >= 400 && ctx.status < 500) {
      handleFailedPasswordChangeAudit(ctx, strapi, ip, path);
    }
  };
};
