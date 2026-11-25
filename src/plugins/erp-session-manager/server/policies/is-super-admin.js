'use strict';

/**
 * is-super-admin policy — restricts access to Strapi Super Admin users only.
 *
 * In Strapi 5, authenticated admin users are on ctx.state.user (not ctx.state.admin).
 * The built-in admin::isAuthenticatedAdmin policy sets ctx.state.isAuthenticated.
 *
 * Applied to all admin routes in server/routes/admin.js.
 * Non-super-admin users receive HTTP 403 (Req 7C.1).
 */

module.exports = (policyContext, _config, { strapi: _strapi }) => {
  // Must be authenticated first
  if (!policyContext.state.isAuthenticated) return false;

  // In Strapi 5, admin user is on ctx.state.user
  const user = policyContext.state.user;
  if (!user) return false;

  // Super admin check: user.roles array contains a role with code 'strapi-super-admin'
  const roles = user.roles || [];
  const isSuperAdmin = roles.some(
    (role) => role.code === 'strapi-super-admin'
  );

  return isSuperAdmin;
};
