'use strict';

/**
 * ActivityLogsAdmin controller — admin API for erp-session-activity records (G19/T23).
 *
 * GET  /erp-session-manager/activity-logs                    — paginated list with filters
 * GET  /erp-session-manager/activity-logs/session/:sessionId — per-session log
 * DELETE /erp-session-manager/activity-logs/cleanup          — manual retention cleanup
 *
 * References: Gap G2 (activity log), G19 (Activity Log page backend)
 */

const { envelope, envelopeError, setRequestId } = require('../../utils/response');

module.exports = ({ strapi }) => ({
  /**
   * GET /erp-session-manager/activity-logs
   * Paginated, filterable list of session activity records.
   */
  async list(ctx) {
    setRequestId(ctx);
    try {
      const {
        sessionId,
        userId,
        method,
        page     = 1,
        pageSize = 25,
      } = ctx.query;

      const filters = {};
      if (sessionId) filters.sessionId = { $eq: sessionId };
      if (userId)    filters.userId    = { $eq: Number(userId) };
      if (method)    filters.method    = { $eq: method.toUpperCase() };

      const safePage     = Math.max(1, Number(page));
      const safePageSize = Math.min(100, Math.max(1, Number(pageSize)));

      const [data, total] = await Promise.all([
        strapi.documents('plugin::erp-session-manager.erp-session-activity').findMany({
          filters,
          sort:  { loggedAt: 'desc' },
          start: (safePage - 1) * safePageSize,
          limit: safePageSize,
        }),
        strapi.documents('plugin::erp-session-manager.erp-session-activity').count({ filters }),
      ]);

      ctx.body = envelope(data, {
        pagination: {
          page:      safePage,
          pageSize:  safePageSize,
          total,
          pageCount: Math.ceil(total / safePageSize),
        },
      });
    } catch (err) {
      ctx.status = 500;
      ctx.body = envelopeError(500, 'InternalServerError', err.message);
    }
  },

  /**
   * GET /erp-session-manager/activity-logs/session/:sessionId
   * Returns activity logs for a specific session (most recent first).
   */
  async listBySession(ctx) {
    setRequestId(ctx);
    try {
      const { sessionId }  = ctx.params;
      const { page = 1, pageSize = 50 } = ctx.query;

      const safePage     = Math.max(1, Number(page));
      const safePageSize = Math.min(200, Math.max(1, Number(pageSize)));

      const data = await strapi
        .documents('plugin::erp-session-manager.erp-session-activity')
        .findMany({
          filters: { sessionId: { $eq: sessionId } },
          sort:    { loggedAt: 'desc' },
          start:   (safePage - 1) * safePageSize,
          limit:   safePageSize,
        });

      ctx.body = envelope(data);
    } catch (err) {
      ctx.status = 500;
      ctx.body = envelopeError(500, 'InternalServerError', err.message);
    }
  },

  /**
   * DELETE /erp-session-manager/activity-logs/cleanup
   * Manually triggers retention-based cleanup (also runs automatically via cron).
   */
  async cleanup(ctx) {
    setRequestId(ctx);
    try {
      const policyService = strapi.plugin('erp-session-manager').service('policy');
      const policy        = await policyService.getPolicy();
      const retentionDays = policy.activityLogRetentionDays ?? 30;
      const cutoff        = new Date(Date.now() - retentionDays * 86400000).toISOString();

      await strapi
        .documents('plugin::erp-session-manager.erp-session-activity')
        .deleteMany({ filters: { loggedAt: { $lt: cutoff } } });

      ctx.body = envelope({ cleaned: true, cutoff, retentionDays });
    } catch (err) {
      ctx.status = 500;
      ctx.body = envelopeError(500, 'InternalServerError', err.message);
    }
  },
});
