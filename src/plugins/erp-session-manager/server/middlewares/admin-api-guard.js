'use strict';

// VAPT #13: paths where the full permission tree must be restricted to super-admins.
// Any authenticated admin can call these today — content managers / editors have no
// legitimate need to enumerate all plugin names, content-type structures, and action UIDs.
const GUARDED_PATHS = ['/admin/permissions'];

module.exports = (_config, { strapi }) =>
  async (ctx, next) => {
    await next(); // let Strapi handle the request (admin auth runs inside the routing layer)

    if (!GUARDED_PATHS.includes(ctx.path) || ctx.method !== 'GET' || ctx.status !== 200) return;

    try {
      const user = ctx.state?.user;
      if (!user) return; // already rejected by Strapi's own auth — don't double-respond

      const isSuperAdmin = (user.roles || []).some((r) => r.code === 'strapi-super-admin');
      if (!isSuperAdmin) {
        ctx.status = 403;
        ctx.body = {
          data: null,
          error: {
            status: 403,
            name: 'ForbiddenError',
            message: 'Access restricted to super administrators.',
          },
        };
      }
    } catch (err) {
      strapi.log.warn(`[erp-session-manager] admin-api-guard error: ${err.message}`);
      // Non-fatal — never block a legitimate request on guard failure
    }
  };
