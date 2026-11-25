'use strict';

/**
 * Decode the admin Bearer token to get userId without relying on ctx.state.user.
 * ctx.state.user is populated by the admin::isAuthenticatedAdmin POLICY which runs
 * during route handling — AFTER the middleware pipeline — so it is always null here.
 *
 * We only need the userId to look up the pendingTotp Map — Strapi's own policy
 * will do full signature verification during route handling. So jwt.decode() is
 * sufficient here (no signature check needed for this lookup).
 *
 * Returns the numeric userId or null if the token is absent / malformed.
 */
function resolveAdminUserId(ctx) {
  try {
    const authHeader = ctx.get('Authorization') || ctx.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return null;
    const token   = authHeader.slice(7);
    // Lazy require avoids any module-load-time side effects
    const decoded = require('jsonwebtoken').decode(token);
    const id = decoded?.userId ?? decoded?.id;
    return id ? Number(id) : null;
  } catch {
    return null;
  }
}

/**
 * StepUpAuth_Middleware — enforces TOTP step-up authentication on sensitive admin routes.
 *
 * When stepUp.enabled is true, intercepts requests to protected route groups
 * and requires a valid X-Step-Up-Token header.
 *
 * Protected route groups (configurable via stepUp.protectedRoutes) — both are
 * WRITE-only; safe reads are never gated (see WRITE_METHODS below):
 *   password_change   — the signed-in admin changing their own password
 *                       (PUT /admin/users/me), plus the legacy
 *                       POST /admin/change-password (VAPT #4)
 *   policy_management — PUT/PATCH /erp-session-manager/config
 *
 * `user_management` and `role_management` were REMOVED on request. Creating,
 * editing or deleting admin users and roles no longer prompts for TOTP, and
 * neither group is classified any more — putting either name back into
 * stepUp.protectedRoutes now does nothing without restoring the matcher here.
 *
 * That includes an admin setting ANOTHER user's password from
 * Settings → Users (PUT /admin/users/:id). It was briefly gated; it is not
 * any more, because that route is user management. The consequence is that
 * only the account owner's own password change is behind a second factor —
 * flagged and accepted.
 *
 * References: Req 18.3.4–18.3.6, Req 18.4, Design §15.4
 */

/**
 * HTTP methods that change state. Step-up demands a *fresh* TOTP code, so it
 * must only ever fire on these — never on a safe read.
 *
 * Gating GET as well is what made the admin panel unusable with MFA on: merely
 * opening Settings → Users (`GET /admin/users`) or clicking a row to edit it
 * (`GET /admin/users/:id`) answered 403 { stepUpRequired: true }, and the fetch
 * interceptor in `src/admin/app.js` turns any such 403 into the authenticator
 * overlay. Step-up tokens are single-use (`_usedJtis` in services/step-up.js),
 * so each following read re-prompted — one popup per click.
 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Is this the signed-in admin changing their OWN password?
 *
 * This is the only thing step-up gates on the user routes. Two shapes qualify:
 *
 *   PUT  /admin/users/me   + password / currentPassword  — the profile page at
 *        /admin/users/me. Strapi's profileUpdateSchema requires currentPassword
 *        whenever password is present, but that validation runs AFTER this
 *        middleware, so both keys are checked rather than trusting the pairing.
 *   POST /admin/change-password                          — legacy path.
 *
 * `PUT /admin/users/:id` is deliberately NOT here: that is user management, and
 * user management is no longer gated at all. An admin resetting another user's
 * password from Settings → Users therefore needs no TOTP.
 *
 * A blank field is not a password change: the profile form submits an empty
 * string when the field is left alone, and '' is falsy here.
 *
 * ctx.request.body is already parsed — strapi::body runs before this middleware.
 *
 * @param {object} ctx — Koa context
 * @returns {boolean}
 */
function isPasswordChangeRequest(ctx) {
  const verb = (ctx.method || '').toUpperCase();
  const path = (ctx.path || '').split('?')[0];
  const body = ctx.request?.body;

  if (verb === 'POST' && path === '/admin/change-password') return true;
  if (verb !== 'PUT' || !body) return false;
  if (path !== '/admin/users/me') return false;

  return Boolean(body.password || body.currentPassword);
}

/**
 * Classify a request into a route group.
 * Returns the group name string or null if not a protected route.
 *
 * @param {string} method
 * @param {string} url
 * @returns {string|null}
 */
function classifyRoute(method, url) {
  // Strip query string for matching
  const path = url.split('?')[0];
  const verb = method.toUpperCase();

  // Reads (GET/HEAD/OPTIONS) are never a step-up trigger. Every group below is
  // a mutation, so this single guard covers all of them.
  if (!WRITE_METHODS.has(verb)) {
    return null;
  }

  // No user_management / role_management matcher — both were removed on
  // request, so /admin/users** and /admin/roles** fall straight through.

  // policy_management: PUT or PATCH on /erp-session-manager/config
  if (/^\/erp-session-manager\/config$/.test(path) && ['PUT', 'PATCH'].includes(verb)) {
    return 'policy_management';
  }

  // password_change: POST /admin/change-password — legacy path (kept for forward-compat)
  if (/^\/admin\/change-password$/.test(path) && verb === 'POST') {
    return 'password_change';
  }

  return null;
}

// Paths exempt from the login-gate TOTP block.
// /admin/login            — the password auth step must NEVER be blocked by a TOTP gate;
//                           blocking it creates an irrecoverable lock when the browser
//                           still holds a stale strapi_admin_token cookie.
// /admin/logout           — must always be reachable so the user can log out.
// /admin/renew-token      — Strapi token refresh must not be blocked.
// /admin/forgot-password  — password recovery flow must remain accessible.
// /admin/reset-password   — password reset link handler must remain accessible.
// /erp-session-manager/step-up/* — setup, status, and the verify endpoint.
const LOGIN_GATE_EXEMPT = [
  '/admin/login',
  '/admin/logout',
  '/admin/renew-token',
  '/admin/forgot-password',
  '/admin/reset-password',
];

/**
 * Terminate the session of an admin who was gated at login and never supplied a
 * TOTP code, then answer 401 so the panel sends them back to sign in.
 *
 * Letting an expired gate fall through was a full MFA bypass: the password step
 * had already issued a token, the gate was the only thing holding it, and
 * dropping the gate at the 10-minute mark handed over an authorised session
 * with no second factor ever entered. Waiting was the whole attack.
 *
 * Both session layers have to go, or the token keeps working:
 *   Strapi's own — invalidateRefreshToken deletes every strapi_sessions row for
 *     the user, and the admin auth strategy re-checks isSessionActive on each
 *     request, so the next call is already 401.
 *   The ERP records — revokeAllForUser, for the plugin's own session view.
 *
 * The pending entry is cleared ONLY when the revocation succeeded. If it fails,
 * the entry stays and the next request tries again — the gate must not open
 * because a DB write failed.
 *
 * @param {object} ctx
 * @param {object} strapi
 * @param {number} adminUserId
 * @returns {Promise<void>}
 */
async function terminateExpiredTotpSession(ctx, strapi, adminUserId) {
  const plugin = strapi.plugin('erp-session-manager');
  let revoked = true;

  try {
    const sessionManager = strapi.sessionManager;
    if (sessionManager && typeof sessionManager.hasOrigin === 'function' && sessionManager.hasOrigin('admin')) {
      await sessionManager('admin').invalidateRefreshToken(String(adminUserId));
    }
  } catch (err) {
    revoked = false;
    strapi.log.warn(`[erp-session-manager] Could not invalidate admin session for ${adminUserId} after TOTP window expiry: ${err.message}`);
  }

  try {
    await plugin.service('session').revokeAllForUser(adminUserId);
  } catch (err) {
    revoked = false;
    strapi.log.warn(`[erp-session-manager] Could not revoke ERP sessions for ${adminUserId} after TOTP window expiry: ${err.message}`);
  }

  try {
    plugin.service('auditLogger').log({
      eventType: 'SESSION_REVOKED',
      userId:    adminUserId,
      ipAddress: ctx.ip || 'unknown',
      userAgent: ctx.get('User-Agent') || '',
      outcome:   'SUCCESS',
      metadata:  { reason: 'TOTP_WINDOW_EXPIRED', sessionsRevoked: revoked },
    });
  } catch { /* audit failure must never change the outcome */ }

  if (revoked) plugin.service('adminLoginTotp').clear(adminUserId);

  ctx.status = 401;
  ctx.body = {
    data:  null,
    meta:  {},
    error: {
      status:  401,
      name:    'UnauthorizedError',
      message: 'Two-factor authentication was not completed in time. Please sign in again.',
      details: { totpExpired: true },
    },
  };
}

/**
 * Path prefixes the post-login gate covers.
 *
 * `/admin/` alone was not enough. This plugin's own admin API is mounted at
 * `/erp-session-manager/*`, which is NOT under `/admin/`, so every one of its
 * routes bypassed the gate: someone sitting at the unanswered TOTP modal could
 * still read sessions, audit logs and the activity log — which now stores
 * request bodies — and rewrite the security policy. The gate is only a gate if
 * it covers everything the half-authenticated session can reach.
 *
 * `/api/**` is deliberately absent: content-API callers are gated separately by
 * contentLoginTotp in session-auth.js.
 */
const GATED_PREFIXES = ['/admin/', '/erp-session-manager/'];

async function handleAdminLoginGate(ctx, strapi) {
  if (!GATED_PREFIXES.some((prefix) => ctx.path.startsWith(prefix))) return true;

  const adminUserId = resolveAdminUserId(ctx);
  if (!adminUserId) return true;

  const adminLoginTotpSvc = strapi.plugin('erp-session-manager').service('adminLoginTotp');
  const gateState = adminLoginTotpSvc.getState(adminUserId);

  if (gateState === 'none') return true;

  if (gateState === 'expired') {
    // /admin/login and /admin/logout must stay reachable so the user can
    // actually recover; everything else ends the session.
    const path = ctx.path.split('?')[0];
    if (path === '/admin/login' || path === '/admin/logout') return true;

    await terminateExpiredTotpSession(ctx, strapi, adminUserId);
    return false;
  }

  const cleanPath = ctx.path.split('?')[0];
  const isExempt =
    LOGIN_GATE_EXEMPT.includes(cleanPath) ||
    cleanPath.startsWith('/erp-session-manager/step-up/');

  if (isExempt) return true;

  const setupRequired = adminLoginTotpSvc.isSetupRequired(adminUserId);
  const setupData     = setupRequired ? adminLoginTotpSvc.getSetupData(adminUserId) : null;
  ctx.status = 403;
  ctx.body = {
    data:  null,
    meta:  {},
    error: {
      status:  403,
      name:    'ForbiddenError',
      message: setupRequired
        ? 'Two-factor authentication setup required. Please scan the QR code to configure your authenticator.'
        : 'Two-factor authentication required. Please verify your authenticator code.',
      details: {
        totpPending:       true,
        totpSetupRequired: setupRequired,
        setup: setupData
          ? {
              qrCodeDataUri:   setupData.qrCodeDataUri,
              base32Secret:    setupData.base32Secret,
              provisioningUri: setupData.provisioningUri,
            }
          : null,
      },
    },
  };
  return false;
}

module.exports = function createStepUpAuthMiddleware(config, { strapi }) {
  return async function stepUpAuthMiddleware(ctx, next) {
    const pluginConfig = strapi.config.get('plugin::erp-session-manager');
    const stepUpConfig = pluginConfig?.stepUp ?? {};

    const stepUpConfigSvc = strapi.plugin('erp-session-manager').service('stepUpConfig');
    const isEnabled = await stepUpConfigSvc.getEnabled();
    if (!isEnabled) {
      return next();
    }

    const gateAllowed = await handleAdminLoginGate(ctx, strapi);
    if (!gateAllowed) {
      return;
    }

    // Body first: only the request body tells a profile password change apart
    // from an ordinary profile save on the same route+method.
    const routeGroup = isPasswordChangeRequest(ctx)
      ? 'password_change'
      : classifyRoute(ctx.method, ctx.path);

    // Not a protected route — pass through
    if (!routeGroup) {
      return next();
    }

    // user_management / role_management are absent by design — see the header.
    const protectedRoutes = stepUpConfig.protectedRoutes ?? [
      'policy_management',
      'password_change',
    ];

    if (!protectedRoutes.includes(routeGroup)) {
      return next();
    }

    // Route is protected — require X-Step-Up-Token header
    const token = ctx.get('X-Step-Up-Token');

    if (!token) {
      // No token provided — challenge the client (Req 18.3.5)
      ctx.status = 403;
      ctx.body = {
        data:  null,
        meta:  {},
        error: {
          status:        403,
          name:          'ForbiddenError',
          message:       'Step-up authentication required for this operation.',
          details:       { stepUpRequired: true, challenge: 'totp', routeGroup },
        },
      };
      return;
    }

    // Verify the step-up token
    const stepUpService = strapi.plugin('erp-session-manager').service('stepUp');
    const clientIp = ctx.ip || ctx.request.ip || 'unknown';
    const result = await stepUpService.verifyStepUpToken(token, clientIp);

    if (!result.valid) {
      // Log the specific failure event
      try {
        const auditLogger = strapi.plugin('erp-session-manager').service('auditLogger');
        const userId = ctx.state?.user?.id;

        const eventTypeMap = {
          expired:      'STEP_UP_FAILURE',
          invalid:      'STEP_UP_FAILURE',
          ip_mismatch:  'STEP_UP_IP_MISMATCH',
          already_used: 'STEP_UP_TOKEN_REUSE',
        };

        auditLogger.log({
          eventType: eventTypeMap[result.reason] || 'STEP_UP_FAILURE',
          userId,
          ipAddress: clientIp,
          userAgent: ctx.get('User-Agent') || '',
          outcome:   'FAILURE',
          metadata:  { reason: result.reason, routeGroup },
        });
      } catch {
        // Audit log failure must never block the response
      }

      ctx.status = 403;
      ctx.body = {
        data:  null,
        meta:  {},
        error: {
          status:  403,
          name:    'ForbiddenError',
          message: 'Step-up token is invalid or expired.',
          details: { stepUpRequired: true, reason: result.reason, routeGroup },
        },
      };
      return;
    }

    // Valid token — log success and proceed (Req 18.3.6)
    try {
      const auditLogger = strapi.plugin('erp-session-manager').service('auditLogger');
      const userId = ctx.state?.user?.id ?? result.payload?.sub;

      auditLogger.log({
        eventType: 'STEP_UP_SUCCESS',
        userId,
        ipAddress: clientIp,
        userAgent: ctx.get('User-Agent') || '',
        outcome:   'SUCCESS',
        metadata:  { routeGroup },
      });
    } catch {
      // Audit log failure must never block the response
    }

    return next();
  };
};
