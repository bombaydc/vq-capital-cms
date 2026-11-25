'use strict';

/**
 * SessionAuth_Middleware — validates server-side session state after Strapi JWT auth.
 *
 * Pipeline position: after Strapi's built-in JWT middleware (Design §2.2 step 4).
 *
 * Checks performed in order:
 *   0. O(1) in-memory revocation check (G9) — short-circuits DB lookup
 *   0b. Per-user revocation timestamp check (G14)
 *   1. Look up Session_Record by userId from JWT payload
 *   2. Check isRevoked → 401 (Req 2.6)
 *   3. Check idle timeout → 401 + SESSION_EXPIRED audit log (Req 3.4, Req 3.6)
 *   4. Check absolute timeout → 401 + SESSION_EXPIRED audit log (Req 3.5, Req 3.6)
 *   5. Update lastActive timestamp (Req 3.3)
 *   6. Run AnomalyDetector → revoke + 401 if shouldBlock (Req 5.3, Req 5.4)
 *      also fires admin alert email if policy.alertAnomaly (G5)
 *
 * Identifying the caller:
 *   This runs as an APP-level Koa middleware, i.e. before the router. Strapi
 *   composes its `authenticate` middleware inside the route handler
 *   (@strapi/core services/server/compose-endpoint.js), so `ctx.state.user` is
 *   still undefined here on every request — the same constraint step-up-auth and
 *   admin-api-guard already work around. Reading it alone made this entire
 *   middleware a no-op in production: idle/absolute timeout, session revocation
 *   and anomaly detection never ran.
 *
 *   So the user is resolved from the Bearer token instead. The signature is
 *   FULLY VERIFIED (admin session manager key, or the users-permissions JWT
 *   secret) — never jwt.decode(). An unverified id would let anyone assert an
 *   arbitrary userId and trip the anomaly path to revoke another user's
 *   session at will.
 *
 * References: Req 2.6, Req 3.3–3.6, Req 5.1–5.5, Design §2.2, Gap G9, G14, G15
 */

const { sanitizeUserAgent, sanitizeIpAddress } = require('../utils/sanitize-ua');

// Paths that must stay reachable even when the caller's session is expired or
// revoked, so a stale credential can never lock someone out of recovering.
// Note admin-session-hardener synthesizes an Authorization header from the
// strapi_admin_token cookie — without this list a stale cookie would make
// /admin/login itself 401, which is unrecoverable from the browser.
// /admin/access-token is safe to exempt: Strapi's native session manager
// enforces its own idle window on refresh-token rotation.
const AUTH_EXEMPT_PATHS = new Set([
  '/admin/login',
  '/admin/logout',
  '/admin/renew-token',
  '/admin/access-token',
  '/admin/forgot-password',
  '/admin/reset-password',
  '/admin/register-admin',
  '/api/auth/local',
  '/api/auth/local/register',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/erp-session-manager/refresh',
  '/api/erp-session-manager/logout',
  '/api/erp-session-manager/logout-all',
  '/api/erp-session-manager/captcha/challenge',
]);

/**
 * Resolve the authenticated caller for this request.
 *
 * Order: ctx.state.user (set when this middleware is used route-scoped, and by
 * the unit tests) → verified admin access token → verified users-permissions
 * JWT. Returns null for anonymous requests and for Strapi API tokens, which are
 * not user sessions and must fall through untouched.
 *
 * sessionType matters because admin_users.id and up_users.id are independent
 * sequences — admin #1 and content user #1 are different people sharing one
 * session store.
 *
 * @returns {{ userId: number, sessionType: 'admin'|'content' }|null}
 */
function resolveAdminToken(token, strapi) {
  try {
    if (typeof strapi.sessionManager === 'function' && strapi.sessionManager.hasOrigin('admin')) {
      const { isValid, payload } = strapi.sessionManager('admin').validateAccessToken(token);
      if (isValid && payload?.userId) {
        return { userId: Number(payload.userId), sessionType: 'admin' };
      }
    }
  } catch {
    // Not an admin token — fall through to content-API check.
  }
  return null;
}

async function resolveContentToken(token, strapi) {
  try {
    const jwtService = strapi.plugin('users-permissions').service('jwt');
    const payload    = await jwtService.verify(token);
    if (payload?.id) {
      return { userId: Number(payload.id), sessionType: 'content' };
    }
  } catch {
    // Invalid / non-JWT credential — treat as anonymous.
  }
  return null;
}

async function resolveCaller(ctx, strapi) {
  const authHeader = ctx.get('Authorization') || ctx.get('authorization') || '';
  const token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (token) {
    const adminResult = resolveAdminToken(token, strapi);
    if (adminResult) return adminResult;

    const contentResult = await resolveContentToken(token, strapi);
    if (contentResult) return contentResult;
  }

  const stateId = ctx.state?.user?.id;
  if (stateId) {
    return {
      userId: Number(stateId),
      sessionType: ctx.path.startsWith('/admin') ? 'admin' : 'content',
    };
  }

  return null;
}

// ============================================================================
// MIDDLEWARE HELPER FUNCTIONS - Extracted to reduce complexity
// ============================================================================

/**
 * Checks if token is revoked using in-memory hash check
 */
async function checkTokenRevocation(ctx, strapi, userId) {
  try {
    const tokenRevocation = strapi.plugin('erp-session-manager').service('tokenRevocation');
    const CryptoUtils = require('../utils/crypto');
    const authHeader = ctx.get('Authorization') || ctx.get('authorization') || '';
    
    if (!authHeader.startsWith('Bearer ')) return null;

    const rawToken = authHeader.slice(7);
    const hash = CryptoUtils.hashToken(rawToken);
    
    if (tokenRevocation.isRevokedByHash(hash)) {
      return {
        status: 401,
        body: {
          data: null,
          meta: {},
          error: {
            status: 401,
            name: 'UnauthorizedError',
            message: 'Token has been revoked.',
            details: { reason: 'REVOKED' },
          },
        },
      };
    }

    // Check per-user revocation timestamp
    const decoded = require('jsonwebtoken').decode(rawToken);
    if (decoded?.iat && tokenRevocation.isUserRevoked(userId, decoded.iat * 1000)) {
      return {
        status: 401,
        body: {
          data: null,
          meta: {},
          error: {
            status: 401,
            name: 'UnauthorizedError',
            message: 'All sessions have been revoked.',
            details: { reason: 'ALL_REVOKED' },
          },
        },
      };
    }

    return null;
  } catch {
    // Token revocation check failure must never block a legitimate request
    return null;
  }
}

/**
 * Finds the active session for the current device/user
 */
function findActiveSession(userSessions, sessionType, ip, userAgent, now) {
  const activeSessions = userSessions.filter(
    (s) => !s.isRevoked && s.expiresAt > now && (!s.sessionType || s.sessionType === sessionType)
  );

  if (activeSessions.length === 0) return null;

  const CryptoUtils = require('../utils/crypto');
  const deviceId = CryptoUtils.hashToken(`${userAgent}:${ip}`);
  
  return (
    activeSessions.find((s) => s.deviceId === deviceId) ||
    activeSessions.reduce((prev, curr) =>
      (curr.lastActive ?? 0) > (prev.lastActive ?? 0) ? curr : prev
    )
  );
}

/**
 * Handles session revocation response
 */
function createRevokedSessionResponse(auditLogger, userId, sessionId, ip, userAgent) {
  auditLogger.log({
    eventType: 'REVOKED_TOKEN_USE',
    userId,
    sessionId,
    ipAddress: ip,
    userAgent,
    outcome: 'FAILURE',
  });

  return {
    status: 401,
    body: {
      data: null,
      meta: {},
      error: {
        status: 401,
        name: 'UnauthorizedError',
        message: 'Session has been revoked.',
        details: { reason: 'REVOKED' },
      },
    },
  };
}

/**
 * Checks session timeouts and returns appropriate response if expired
 */
async function checkSessionTimeouts(sessionService, store, sessionRecord, auditLogger, userId, ip, userAgent) {
  const timeoutResult = await sessionService.checkTimeouts(sessionRecord);
  
  if (!timeoutResult.valid) {
    const revokeReason = timeoutResult.reason === 'IDLE' ? 'idle_timeout' : 'absolute_timeout';
    await store.markRevoked(sessionRecord.sessionId, { reason: revokeReason });
    
    auditLogger.log({
      eventType: 'SESSION_EXPIRED',
      userId,
      sessionId: sessionRecord.sessionId,
      ipAddress: ip,
      userAgent,
      outcome: 'FAILURE',
      metadata: { reason: timeoutResult.reason },
    });

    return {
      status: 401,
      body: {
        data: null,
        meta: {},
        error: {
          status: 401,
          name: 'UnauthorizedError',
          message: `Session expired (${timeoutResult.reason}).`,
          details: { reason: timeoutResult.reason },
        },
      },
    };
  }

  return null;
}

/**
 * Logs anomaly events to audit log
 */
function logAnomalyEvents(auditLogger, anomalies, userId, sessionId, ip, userAgent) {
  const eventTypeMap = {
    IP_CHANGE: 'ANOMALY_IP_CHANGE',
    UA_CHANGE: 'ANOMALY_UA_CHANGE',
    IMPOSSIBLE_TRAVEL: 'ANOMALY_IMPOSSIBLE_TRAVEL',
  };

  for (const anomaly of anomalies) {
    auditLogger.log({
      eventType: eventTypeMap[anomaly] || 'ANOMALY_IP_CHANGE',
      userId,
      sessionId,
      ipAddress: ip,
      userAgent,
      outcome: 'FAILURE',
      metadata: { anomalies },
    });
  }
}

/**
 * Revokes session in memory and sends admin alert if configured
 */
async function revokeSessionAndAlert(strapi, sessionRecord, userId, ip, anomalies) {
  // Add to in-memory revocation set
  try {
    const tokenRevocation = strapi.plugin('erp-session-manager').service('tokenRevocation');
    if (sessionRecord.refreshTokenHash) {
      tokenRevocation.revokeByHash(sessionRecord.refreshTokenHash);
    }
  } catch {
    /* non-fatal */
  }

  // Send alert if policy requires it
  try {
    const policyService = strapi.plugin('erp-session-manager').service('policy');
    const adminAlertSvc = strapi.plugin('erp-session-manager').service('adminAlert');
    const policy = await policyService.getPolicy();
    
    if (policy.alertAnomaly) {
      adminAlertSvc.sendAnomalyAlert({
        userId,
        userEmail: null,
        reason: 'SESSION_ANOMALY',
        metadata: { anomalies, ip },
      });
    }
  } catch {
    /* non-fatal */
  }
}

/**
 * Handles anomaly detection and response.
 *
 * Takes a single options object rather than a positional list: the ten
 * collaborators this needs were impossible to call correctly by position
 * (SonarQube S107 caps positional params at 7), and `ip`/`userAgent` sat
 * adjacent as same-typed strings — a silent swap waiting to happen.
 *
 * @param {object} deps
 * @param {object} deps.anomalyDetector
 * @param {object} deps.sessionRecord
 * @param {object} deps.requestContext
 * @param {import('../services/store/interface')} deps.store
 * @param {object} deps.strapi
 * @param {object} deps.auditLogger
 * @param {number} deps.userId
 * @param {string} deps.ip
 * @param {string} deps.userAgent
 * @param {number} deps.now
 * @returns {Promise<{status: number, body: object}|null>} response to send, or null to continue
 */
async function handleAnomalies({
  anomalyDetector,
  sessionRecord,
  requestContext,
  store,
  strapi,
  auditLogger,
  userId,
  ip,
  userAgent,
  now,
}) {
  const anomalyResult = await anomalyDetector.check(sessionRecord, requestContext);

  if (anomalyResult.shouldBlock) {
    await store.markRevoked(sessionRecord.sessionId, { reason: 'anomaly' });
    logAnomalyEvents(auditLogger, anomalyResult.anomalies, userId, sessionRecord.sessionId, ip, userAgent);
    await revokeSessionAndAlert(strapi, sessionRecord, userId, ip, anomalyResult.anomalies);

    return {
      status: 401,
      body: {
        data: null,
        meta: {},
        error: {
          status: 401,
          name: 'UnauthorizedError',
          message: 'Session terminated due to security anomaly.',
          details: { anomalies: anomalyResult.anomalies },
        },
      },
    };
  }

  // Update anomaly flags for non-blocking anomalies
  if (anomalyResult.anomalies.length > 0) {
    const record = await store.get(sessionRecord.sessionId);
    if (record) {
      record.anomalyFlags = [...new Set([...(record.anomalyFlags || []), ...anomalyResult.anomalies])];
      const remainingMs = Math.max(0, record.expiresAt - now);
      await store.set(sessionRecord.sessionId, record, remainingMs);
    }
  }

  return null;
}

/**
 * Checks if TOTP verification is pending and blocks access if needed
 */
function checkTotpVerification(strapi, userId, ctx) {
  try {
    const pluginConfig = strapi.config.get('plugin::erp-session-manager');
    if (pluginConfig?.stepUp?.enforceForContentApi !== true) {
      return null;
    }

    const contentLoginTotpSvc = strapi.plugin('erp-session-manager').service('contentLoginTotp');
    if (!contentLoginTotpSvc?.isPending(userId)) {
      return null;
    }

    const TOTP_EXEMPT_PATHS = [
      '/api/erp-session/step-up/verify-login-totp',
      '/api/erp-session/logout',
      '/api/erp-session/logout-all',
    ];

    if (!TOTP_EXEMPT_PATHS.includes(ctx.path)) {
      return {
        status: 403,
        body: {
          data: null,
          meta: {},
          error: {
            status: 403,
            name: 'ForbiddenError',
            message: 'TOTP verification required to access this resource.',
            details: { totpPending: true },
          },
        },
      };
    }

    return null;
  } catch {
    // Non-fatal — never block a legitimate request on TOTP service failure
    return null;
  }
}

// ============================================================================
// MAIN MIDDLEWARE - Refactored from complexity 34 to ~8
// ============================================================================

module.exports = (config, { strapi }) => {
  return async (ctx, next) => {
    if (AUTH_EXEMPT_PATHS.has(ctx.path)) {
      return next();
    }

    const caller = await resolveCaller(ctx, strapi);
    if (!caller) {
      return next();
    }
    const { userId, sessionType } = caller;

    // Check token revocation
    const revocationResponse = await checkTokenRevocation(ctx, strapi, userId);
    if (revocationResponse) {
      ctx.status = revocationResponse.status;
      ctx.body = revocationResponse.body;
      return;
    }

    // Get services
    const sessionService = strapi.plugin('erp-session-manager').service('session');
    const auditLogger = strapi.plugin('erp-session-manager').service('auditLogger');
    const anomalyDetector = strapi.plugin('erp-session-manager').service('anomalyDetector');

    // Find active session
    const storeModule = require('../services/store');
    const store = storeModule.getStore();
    const userSessions = await store.getByUser(userId);
    const now = Date.now();

    const ip = sanitizeIpAddress(ctx.ip || ctx.request.ip || 'unknown');
    const userAgent = sanitizeUserAgent(ctx.get('User-Agent') || '');

    const sessionRecord = findActiveSession(userSessions, sessionType, ip, userAgent, now);

    if (!sessionRecord) {
      ctx.status = 401;
      ctx.body = {
        data: null,
        meta: {},
        error: {
          status: 401,
          name: 'UnauthorizedError',
          message: 'No active session found or session has expired. Please log in again.',
          details: { reason: 'NO_ACTIVE_SESSION' },
        },
      };
      return;
    }

    // Check if session is revoked
    if (sessionRecord.isRevoked) {
      const response = createRevokedSessionResponse(auditLogger, userId, sessionRecord.sessionId, ip, userAgent);
      ctx.status = response.status;
      ctx.body = response.body;
      return;
    }

    // Check session timeouts
    const timeoutResponse = await checkSessionTimeouts(
      sessionService,
      store,
      sessionRecord,
      auditLogger,
      userId,
      ip,
      userAgent
    );
    if (timeoutResponse) {
      ctx.status = timeoutResponse.status;
      ctx.body = timeoutResponse.body;
      return;
    }

    // Update last active timestamp
    await store.updateLastActive(sessionRecord.sessionId, now);

    // Handle anomaly detection
    const requestContext = { ipAddress: ip, userAgent, timestamp: now };
    const anomalyResponse = await handleAnomalies({
      anomalyDetector,
      sessionRecord,
      requestContext,
      store,
      strapi,
      auditLogger,
      userId,
      ip,
      userAgent,
      now,
    });
    if (anomalyResponse) {
      ctx.status = anomalyResponse.status;
      ctx.body = anomalyResponse.body;
      return;
    }

    // Check TOTP verification requirement
    const totpResponse = checkTotpVerification(strapi, userId, ctx);
    if (totpResponse) {
      ctx.status = totpResponse.status;
      ctx.body = totpResponse.body;
      return;
    }

    await next();
  };
};
