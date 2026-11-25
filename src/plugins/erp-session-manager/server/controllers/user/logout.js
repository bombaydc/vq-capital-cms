'use strict';

/**
 * User Logout Controllers
 *
 * Endpoints (Design §6.3):
 *   POST /api/erp-session/logout      — logout current session (Req 16.12)
 *   POST /api/erp-session/logout-all  — logout all sessions for user (Req 16.13)
 *
 * References: Req 16.12–16.13, Design §6.3
 */

const { envelope, setRequestId } = require('../../utils/response');

module.exports = ({ strapi }) => ({
  /**
   * POST /api/erp-session/logout
   */
  async logout(ctx) {
    setRequestId(ctx);

    // VAPT #10 Gap 2: capture the JWT BEFORE onLogout() clears auth context
    const rawToken = (ctx.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();

    // Require *some* credential before doing any work.
    //
    // Deliberately NOT `ctx.state.user` alone (the guard logoutAll uses): this
    // handler revokes via the erp_rt cookie, not via userId, so demanding a live
    // JWT would break logout for anyone whose access token has already expired —
    // precisely when the refresh cookie most needs revoking.
    //
    // With neither credential there is no session to end. Returning before
    // onLogout() matters because onLogout() unconditionally writes a
    // LOGOUT/SUCCESS audit row, which let unauthenticated callers flood
    // erp_session_audit_logs with user_id=null entries.
    const pluginConfig = strapi.config.get('plugin::erp-session-manager');
    const cookieName   = pluginConfig?.cookies?.name || 'erp_rt';
    const hasCookie    = Boolean(ctx.cookies.get(cookieName));
    const hasUser      = Boolean(ctx.state?.user?.id);

    if (!rawToken && !hasCookie && !hasUser) {
      ctx.status = 401;
      ctx.body = { data: null, meta: {}, error: { status: 401, name: 'UnauthorizedError', message: 'Authentication required.' } };
      return;
    }

    const usersPermissionsHooks = strapi.plugin('erp-session-manager').service('usersPermissionsHooks');
    await usersPermissionsHooks.onLogout(ctx);

    // Blacklist the access JWT so session-auth's O(1) hash check rejects any
    // subsequent request with the same token, even before the store is consulted.
    if (rawToken) {
      try {
        const CryptoUtils     = require('../../utils/crypto');
        const tokenRevocation = strapi.plugin('erp-session-manager').service('tokenRevocation');
        tokenRevocation.revokeByHash(CryptoUtils.hashToken(rawToken));
      } catch { /* non-fatal — ERP session isRevoked flag still blocks reuse */ }
    }

    ctx.body = envelope({ loggedOut: true });
  },

  /**
   * POST /api/erp-session/logout-all
   */
  async logoutAll(ctx) {
    setRequestId(ctx);
    const userId = ctx.state && ctx.state.user && ctx.state.user.id;
    if (!userId) {
      ctx.status = 401;
      ctx.body = { data: null, meta: {}, error: { status: 401, name: 'UnauthorizedError', message: 'Authentication required.' } };
      return;
    }

    const sessionService = strapi.plugin('erp-session-manager').service('session');
    const auditLogger    = strapi.plugin('erp-session-manager').service('auditLogger');
    const pluginConfig   = strapi.config.get('plugin::erp-session-manager');
    const cookieName     = (pluginConfig && pluginConfig.cookies && pluginConfig.cookies.name) || 'erp_rt';

    const count = await sessionService.revokeAllForUser(userId);

    // Clear the cookie
    ctx.cookies.set(cookieName, '', { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 0, path: '/' });

    auditLogger.log({
      eventType: 'LOGOUT',
      userId,
      ipAddress: ctx.ip || ctx.request.ip,
      userAgent: ctx.get('User-Agent'),
      outcome:   'SUCCESS',
      metadata:  { revokedCount: count, logoutAll: true },
    });

    ctx.body = envelope({ loggedOut: true, revokedCount: count });
  },
});
