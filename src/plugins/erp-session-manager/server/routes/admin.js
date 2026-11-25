'use strict';

/**
 * Admin routes for erp-session-manager.
 *
 * Strapi 5 automatically prepends /<plugin-name> to all plugin routes,
 * so paths here are RELATIVE (no /erp-session-manager/ prefix).
 *
 * Handler format: '<controllerKey>.<methodName>'
 * where controllerKey matches the key in server/index.js controllers object.
 *
 * Policies:
 *   admin::isAuthenticatedAdmin — validates the admin JWT (sets ctx.state.user)
 *   plugin::erp-session-manager.is-super-admin — restricts to Super Admin role
 *
 * Design §6.2
 */

const ADMIN_POLICIES = [
  'admin::isAuthenticatedAdmin',
  'plugin::erp-session-manager.is-super-admin',
];

module.exports = {
  type: 'admin',
  routes: [
    // Sessions — order matters: /bulk and /user/:userId before /:sessionId
    { method: 'GET',    path: '/sessions',                handler: 'sessions.list',        config: { policies: ADMIN_POLICIES } },
    { method: 'GET',    path: '/sessions/:sessionId',     handler: 'sessions.findOne',     config: { policies: ADMIN_POLICIES } },
    { method: 'DELETE', path: '/sessions/bulk',           handler: 'sessions.revokeBulk',  config: { policies: ADMIN_POLICIES } },
    { method: 'POST',   path: '/sessions/bulk',           handler: 'sessions.revokeBulk',  config: { policies: ADMIN_POLICIES } },
    { method: 'DELETE', path: '/sessions/user/:userId',   handler: 'sessions.revokeByUser',config: { policies: ADMIN_POLICIES } },
    { method: 'DELETE', path: '/sessions/:sessionId',     handler: 'sessions.revoke',      config: { policies: ADMIN_POLICIES } },
    // Redis connectivity test
    { method: 'POST',   path: '/store/test-redis',        handler: 'sessions.testRedis',   config: { policies: ADMIN_POLICIES } },
    // Audit logs — /export before / to avoid route shadowing
    { method: 'GET',    path: '/audit-logs/export',       handler: 'audit-logs.exportCsv', config: { policies: ADMIN_POLICIES } },
    { method: 'GET',    path: '/audit-logs',              handler: 'audit-logs.list',      config: { policies: ADMIN_POLICIES } },
    // Status & config
    { method: 'GET',    path: '/status',                  handler: 'status.getStatus',         config: { policies: ADMIN_POLICIES } },
    { method: 'GET',    path: '/config',                  handler: 'config.getConfig',         config: { policies: ADMIN_POLICIES } },
    // VAPT #20 — CAPTCHA config (admin panel managed, persisted to strapi.store)
    { method: 'GET',    path: '/config/captcha',          handler: 'config.getCaptchaConfig',  config: { policies: ADMIN_POLICIES } },
    { method: 'PUT',    path: '/config/captcha',          handler: 'config.updateCaptchaConfig', config: { policies: ADMIN_POLICIES } },
    // Step-up global config — Super Admin only (enable/disable globally, persists across restarts)
    { method: 'GET',  path: '/step-up/global-config',     handler: 'step-up.getGlobalConfig',  config: { policies: ADMIN_POLICIES } },
    { method: 'POST', path: '/step-up/global-config',     handler: 'step-up.setGlobalEnabled', config: { policies: ADMIN_POLICIES } },
    // Step-up authentication routes — any authenticated admin (no Super Admin restriction)
    { method: 'GET',  path: '/step-up/status',            handler: 'step-up.getStatus',        config: { policies: ['admin::isAuthenticatedAdmin'] } },
    { method: 'GET',  path: '/step-up/setup',             handler: 'step-up.getSetup',         config: { policies: ['admin::isAuthenticatedAdmin'] } },
    { method: 'POST', path: '/step-up/setup/verify',      handler: 'step-up.verifySetup',      config: { policies: ['admin::isAuthenticatedAdmin'] } },
    { method: 'POST', path: '/step-up/challenge',         handler: 'step-up.challenge',        config: { policies: ['admin::isAuthenticatedAdmin'] } },
    { method: 'POST', path: '/step-up/remove',            handler: 'step-up.removeSecret',     config: { policies: ['admin::isAuthenticatedAdmin'] } },
    { method: 'POST', path: '/step-up/regenerate',        handler: 'step-up.regenerate',       config: { policies: ['admin::isAuthenticatedAdmin'] } },
    // Post-login TOTP gate — verifies the code shown on the login challenge screen
    { method: 'POST', path: '/step-up/admin-login-totp',  handler: 'step-up.adminLoginTotp',   config: { policies: ['admin::isAuthenticatedAdmin'] } },
    // Live session policy (G4)
    { method: 'GET', path: '/policy',                     handler: 'policy.getPolicy',         config: { policies: ['admin::isAuthenticatedAdmin'] } },
    { method: 'PUT', path: '/policy',                     handler: 'policy.updatePolicy',      config: { policies: ADMIN_POLICIES } },
    // Activity logs (G2/G19) — specific paths before generic
    { method: 'GET',    path: '/activity-logs/session/:sessionId', handler: 'activity-logs-admin.listBySession', config: { policies: ADMIN_POLICIES } },
    { method: 'GET',    path: '/activity-logs',                    handler: 'activity-logs-admin.list',          config: { policies: ADMIN_POLICIES } },
    { method: 'DELETE', path: '/activity-logs/cleanup',            handler: 'activity-logs-admin.cleanup',       config: { policies: ADMIN_POLICIES } },
    // RBAC permissions list (G16/G17)
    { method: 'GET', path: '/permissions',                handler: 'permissions.listPermissions', config: { policies: ['admin::isAuthenticatedAdmin'] } },
  ],
};
