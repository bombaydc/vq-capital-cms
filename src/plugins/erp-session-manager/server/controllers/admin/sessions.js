'use strict';

/**
 * Admin Sessions Controller
 *
 * Endpoints (Design §6.2):
 *   GET    /erp-session-manager/sessions              — paginated list with filters
 *   GET    /erp-session-manager/sessions/:sessionId   — single session or 404
 *   DELETE /erp-session-manager/sessions/:sessionId   — revoke single session
 *   DELETE /erp-session-manager/sessions/user/:userId — revoke all for user
 *   DELETE /erp-session-manager/sessions/bulk         — revoke array of session IDs
 *   POST   /erp-session-manager/store/test-redis      — test Redis connectivity
 *
 * All responses use API_Envelope { data, meta, error } (Req 16.16).
 * All responses include X-Request-Id header (Req 16.18).
 *
 * References: Req 7A, Req 16.1–16.5, Req 16.16–16.18, Design §6.2
 */

const { envelope, envelopeError, setRequestId } = require('../../utils/response');
const storeModule = require('../../services/store');

/**
 * Helper: force-logout a user from the Strapi admin panel immediately.
 *
 * Two-step approach for immediate effect:
 *
 * Step 1 — invalidateRefreshToken: prevents the user from getting a new
 *   access token after the current one expires.
 *
 * Step 2 — delete all admin session records from the DB: Strapi's admin
 *   auth strategy calls isSessionActive(sessionId) on EVERY request.
 *   isSessionActive queries the admin::session content type. If the record
 *   is gone, it returns false → the request is rejected with 401 immediately,
 *   even if the access token JWT is still cryptographically valid.
 *   This gives us immediate forced logout without waiting for token expiry.
 */
async function invalidateAdminSession(strapi, userId) {
  try {
    // Step 1: invalidate refresh token (prevents token renewal)
    const sessionManager = strapi.sessionManager;
    if (sessionManager && typeof sessionManager === 'function' && sessionManager.hasOrigin?.('admin')) {
      await sessionManager('admin').invalidateRefreshToken(String(userId));
    }
  } catch (err) {
    strapi.log.warn(`[erp-session-manager] Failed to invalidate refresh token for user ${userId}: ${err.message}`);
  }

  try {
    // Step 2: delete all Strapi admin session records for this user from the DB.
    // This makes isSessionActive() return false immediately on the next request,
    // forcing the admin panel to redirect to the login page.
    await strapi.db.query('admin::session').deleteMany({
      where: { user: { id: userId } },
    });
    strapi.log.debug(`[erp-session-manager] Deleted admin session records for user ${userId}`);
  } catch (err) {
    strapi.log.warn(`[erp-session-manager] Failed to delete admin session records for user ${userId}: ${err.message}`);
  }
}

module.exports = ({ strapi }) => ({
  /**
   * GET /erp-session-manager/sessions
   * Paginated list with filters: userId, ip, status, sortBy, sortOrder (Req 16.1)
   */
  async list(ctx) {
    setRequestId(ctx);
    const { userId, ip, status, sortBy, sortOrder, page = 1, pageSize = 25 } = ctx.query;

    const store = storeModule.getStore();
    const filters = {
      userId:    userId ? Number(userId) : undefined,
      ip:        ip || undefined,
      status:    status || undefined,
      sortBy:    sortBy || 'issuedAt',
      sortOrder: sortOrder || 'desc',
      page:      Number(page),
      pageSize:  Math.min(Number(pageSize) || 25, 100),
    };

    const { records, total } = await store.listAll(filters);
    const pageCount = Math.ceil(total / filters.pageSize);

    ctx.body = envelope(records, {
      pagination: { page: filters.page, pageSize: filters.pageSize, total, pageCount },
    });
  },

  /**
   * GET /erp-session-manager/sessions/:sessionId
   * Single session or 404 (Req 16.2)
   */
  async findOne(ctx) {
    setRequestId(ctx);
    const { sessionId } = ctx.params;
    const store = storeModule.getStore();
    const record = await store.get(sessionId);

    if (!record) {
      ctx.status = 404;
      ctx.body = envelopeError(404, 'NotFoundError', `Session '${sessionId}' not found.`);
      return;
    }

    ctx.body = envelope(record);
  },

  /**
   * DELETE /erp-session-manager/sessions/:sessionId
   * Revoke single session (Req 16.3)
   */
  async revoke(ctx) {
    setRequestId(ctx);
    const { sessionId } = ctx.params;
    const sessionService = strapi.plugin('erp-session-manager').service('session');
    const store = storeModule.getStore();

    const record = await store.get(sessionId);
    if (!record) {
      ctx.status = 404;
      ctx.body = envelopeError(404, 'NotFoundError', `Session '${sessionId}' not found.`);
      return;
    }

    await sessionService.revokeSession(sessionId);

    // Also invalidate Strapi's internal admin session so the user is
    // forced to re-authenticate on their next request
    if (record.userId) {
      await invalidateAdminSession(strapi, record.userId);
    }

    ctx.body = envelope({ sessionId, revoked: true });
  },

  /**
   * DELETE /erp-session-manager/sessions/user/:userId
   * Revoke all sessions for a user (Req 16.4)
   */
  async revokeByUser(ctx) {
    setRequestId(ctx);
    const userId = Number(ctx.params.userId);
    // VAPT #15: Number() returns NaN for non-numeric strings; Number.isInteger catches NaN + floats
    if (!Number.isInteger(userId) || userId <= 0) {
      ctx.status = 400;
      ctx.body = envelopeError(400, 'ValidationError', 'userId must be a positive integer.');
      return;
    }
    const sessionService = strapi.plugin('erp-session-manager').service('session');
    const count = await sessionService.revokeAllForUser(userId);

    // Invalidate Strapi's internal admin session for this user
    await invalidateAdminSession(strapi, userId);

    ctx.body = envelope({ userId, revokedCount: count });
  },

  /**
   * DELETE /erp-session-manager/sessions/bulk
   * Revoke array of session IDs from request body (Req 16.5)
   */
  async revokeBulk(ctx) {
    setRequestId(ctx);
    let sessionIds = ctx.request.body?.sessionIds;

    // Fallback if sent via query params (e.g. ?sessionIds=a,b,c)
    if (!sessionIds && ctx.query.sessionIds) {
      if (Array.isArray(ctx.query.sessionIds)) {
        sessionIds = ctx.query.sessionIds;
      } else if (typeof ctx.query.sessionIds === 'string') {
        try {
          const parsed = JSON.parse(ctx.query.sessionIds);
          sessionIds = Array.isArray(parsed) ? parsed : [ctx.query.sessionIds];
        } catch {
          sessionIds = ctx.query.sessionIds.split(',').map((s) => s.trim()).filter(Boolean);
        }
      }
    }

    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      ctx.status = 400;
      ctx.body = envelopeError(400, 'ValidationError', 'sessionIds must be a non-empty array.');
      return;
    }
    // VAPT #15: validate each element — must be a non-empty string ≤ 128 chars
    const invalidIds = sessionIds.filter(
      (id) => typeof id !== 'string' || id.trim().length === 0 || id.length > 128
    );
    if (invalidIds.length > 0) {
      ctx.status = 400;
      ctx.body = envelopeError(400, 'ValidationError',
        'sessionIds must be an array of non-empty strings (max 128 chars each).');
      return;
    }

    const store = storeModule.getStore();
    let revokedCount = 0;
    const affectedUserIds = new Set();

    for (const id of sessionIds) {
      const record = await store.get(id);
      if (record && !record.isRevoked) {
        await store.markRevoked(id);
        revokedCount++;
        if (record.userId) affectedUserIds.add(record.userId);
      }
    }

    // Invalidate Strapi admin sessions for all affected users
    for (const userId of affectedUserIds) {
      await invalidateAdminSession(strapi, userId);
    }

    ctx.body = envelope({ revokedCount, sessionIds });
  },

  /**
   * POST /erp-session-manager/store/test-redis
   * Test Redis connectivity and return latency (Req 16.9)
   */
  async testRedis(ctx) {
    setRequestId(ctx);
    const pluginConfig = strapi.config.get('plugin::erp-session-manager');
    const redisConfig = pluginConfig && pluginConfig.store && pluginConfig.store.redis;

    if (!redisConfig || !redisConfig.enabled) {
      ctx.body = envelope({ connected: false, latencyMs: null, message: 'Redis is not enabled.' });
      return;
    }

    const { RedisStore } = storeModule;
    const testStore = new RedisStore(redisConfig, strapi);

    try {
      const start = Date.now();
      await testStore.connect();
      await testStore._client.ping();
      const latencyMs = Date.now() - start;
      await testStore.disconnect();

      ctx.body = envelope({
        connected: true,
        latencyMs,
        host: redisConfig.host || 'via url',
        port: redisConfig.port || 6379,
      });
    } catch (err) {
      try { await testStore.disconnect(); } catch { /* ignore */ }
      ctx.body = envelope({
        connected: false,
        latencyMs: null,
        error: err.message,
      });
    }
  },
});
