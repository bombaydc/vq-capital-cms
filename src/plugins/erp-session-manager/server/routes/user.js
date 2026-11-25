'use strict';

/**
 * End-user (content-api) routes for erp-session-manager.
 *
 * Strapi 5 automatically prepends /api/<plugin-name> to content-api routes,
 * so paths here are RELATIVE (no /erp-session/ prefix).
 *
 * Handler format: '<controllerKey>.<methodName>'
 * where controllerKey matches the key in server/index.js controllers object.
 *
 * Design §6.3
 */

module.exports = {
  type: 'content-api',
  routes: [
    // Token refresh — auth: false because the erp_rt cookie IS the auth
    { method: 'POST',   path: '/refresh',            handler: 'refresh.refresh',       config: { auth: false } },
    // Logout endpoints — require valid user JWT
    { method: 'POST',   path: '/logout',             handler: 'logout.logout',         config: { auth: false } },
    { method: 'POST',   path: '/logout-all',         handler: 'logout.logoutAll',      config: { auth: false } },
    // User's own sessions
    { method: 'GET',    path: '/me/sessions',        handler: 'my-sessions.list',      config: { auth: false } },
    { method: 'DELETE', path: '/me/sessions/:id',    handler: 'my-sessions.revoke',    config: { auth: false } },
    // VAPT #12 — post-login TOTP verification for content-API users
    // auth: false — Strapi JWT middleware still validates the Bearer token and sets ctx.state.user.
    // The controller returns 401 if ctx.state.user is absent.
    { method: 'POST',   path: '/step-up/verify-login-totp', handler: 'content-login-totp.verifyLoginTotp', config: { auth: false } },
    // VAPT #20 — CAPTCHA challenge: GET a new SVG image challenge before login/register
    // auth: false — must be accessible before the user has any credentials
    { method: 'GET',    path: '/captcha/challenge', handler: 'captcha.getChallenge', config: { auth: false } },
  ],
};
