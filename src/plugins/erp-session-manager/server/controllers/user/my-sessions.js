'use strict';

/**
 * User My-Sessions Controllers
 *
 * Endpoints (Design §6.3):
 *   GET    /api/erp-session/me/sessions       — list own sessions (Req 16.14)
 *   DELETE /api/erp-session/me/sessions/:id   — revoke own session (Req 16.15)
 *
 * References: Req 16.14–16.15, Design §6.3
 */

const { envelope, envelopeError, setRequestId } = require('../../utils/response');
const storeModule = require('../../services/store');

module.exports = ({ strapi: _strapi }) => ({
  /**
   * GET /api/erp-session/me/sessions
   */
  async list(ctx) {
    setRequestId(ctx);
    const userId = ctx.state && ctx.state.user && ctx.state.user.id;
    if (!userId) {
      ctx.status = 401;
      ctx.body = envelopeError(401, 'UnauthorizedError', 'Authentication required.');
      return;
    }

    const store = storeModule.getStore();
    const sessions = await store.getByUser(userId);
    const now = Date.now();

    // Determine which session is current (matches the request's refresh token)
    const currentSessionId = ctx.state._erpSessionId || null;

    const data = sessions
      .filter((s) => !s.isRevoked && s.expiresAt > now)
      .map((s) => ({
        sessionId:  s.sessionId.slice(0, 8),
        ipAddress:  s.ipAddress,
        location:   s.geoLocation
          ? [s.geoLocation.city, s.geoLocation.country].filter(Boolean).join(', ') || 'Unknown'
          : 'Unknown',
        userAgent:  s.userAgent ? s.userAgent.slice(0, 60) : '',
        loginTime:  new Date(s.issuedAt).toISOString(),
        lastActive: new Date(s.lastActive).toISOString(),
        expiresAt:  new Date(s.expiresAt).toISOString(),
        isCurrent:  s.sessionId === currentSessionId,
      }));

    ctx.body = envelope(data, { pagination: { total: data.length } });
  },

  /**
   * DELETE /api/erp-session/me/sessions/:id
   */
  async revoke(ctx) {
    setRequestId(ctx);
    const userId = ctx.state && ctx.state.user && ctx.state.user.id;
    if (!userId) {
      ctx.status = 401;
      ctx.body = envelopeError(401, 'UnauthorizedError', 'Authentication required.');
      return;
    }

    const { id: sessionId } = ctx.params;
    const store = storeModule.getStore();
    const record = await store.get(sessionId);

    // Ensure the session belongs to the requesting user
    if (!record || record.userId !== userId) {
      ctx.status = 404;
      ctx.body = envelopeError(404, 'NotFoundError', 'Session not found.');
      return;
    }

    await store.markRevoked(sessionId);
    ctx.body = envelope({ sessionId, revoked: true });
  },
});
