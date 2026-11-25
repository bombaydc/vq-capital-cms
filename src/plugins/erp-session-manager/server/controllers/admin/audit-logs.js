'use strict';

/**
 * Admin Audit Logs Controller
 *
 * Endpoints (Design §6.2):
 *   GET /erp-session-manager/audit-logs         — paginated, filterable list (Req 16.6)
 *   GET /erp-session-manager/audit-logs/export  — streamed CSV download (Req 16.7)
 *
 * Filters: userId, eventType (comma-separated), ipAddress, outcome, from, to
 *
 * References: Req 16.6–16.7, Design §6.2
 */

const { envelope, envelopeError, setRequestId } = require('../../utils/response');

const CSV_COLUMNS = ['timestamp', 'eventType', 'userId', 'sessionId', 'ipAddress', 'userAgent', 'outcome'];

// Characters that trigger formula execution in spreadsheet applications (OWASP safe-CSV)
const CSV_FORMULA_TRIGGER_RE = /^[=+\-@\t]/;

function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Prefix formula-injection trigger characters with a single quote
  // so spreadsheet apps treat the cell as text, not a formula.
  const safe = CSV_FORMULA_TRIGGER_RE.test(str) ? `'${str}` : str;
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function buildFilters(query) {
  const filters = {};
  if (query.userId)    filters.userId    = { $eq: Number(query.userId) };
  if (query.ipAddress) filters.ipAddress = { $eq: query.ipAddress };
  if (query.outcome)   filters.outcome   = { $eq: query.outcome };

  if (query.eventType) {
    const types = query.eventType.split(',').map((t) => t.trim()).filter(Boolean);
    if (types.length === 1) {
      filters.eventType = { $eq: types[0] };
    } else if (types.length > 1) {
      filters.eventType = { $in: types };
    }
  }

  if (query.from || query.to) {
    filters.timestamp = {};
    if (query.from) filters.timestamp.$gte = query.from;
    if (query.to)   filters.timestamp.$lte = query.to;
  }

  return filters;
}

module.exports = ({ strapi }) => ({
  /**
   * GET /erp-session-manager/audit-logs
   * Paginated audit log list with filters (Req 16.6)
   */
  async list(ctx) {
    setRequestId(ctx);

    const page     = Math.max(1, Number(ctx.query.page) || 1);
    const pageSize = Math.min(Number(ctx.query.pageSize) || 25, 100);
    const filters  = buildFilters(ctx.query);

    try {
      const [entries, total] = await Promise.all([
        strapi.documents('plugin::erp-session-manager.erp-session-audit-log').findMany({
          filters,
          sort:  { timestamp: 'desc' },
          start: (page - 1) * pageSize,
          limit: pageSize,
        }),
        strapi.documents('plugin::erp-session-manager.erp-session-audit-log').count({ filters }),
      ]);

      const pageCount = Math.ceil(total / pageSize);
      ctx.body = envelope(entries, {
        pagination: { page, pageSize, total, pageCount },
      });
    } catch (err) {
      ctx.status = 500;
      ctx.body = envelopeError(500, 'InternalServerError', err.message);
    }
  },

  /**
   * GET /erp-session-manager/audit-logs/export
   * Streamed CSV download (Req 16.7)
   */
  async exportCsv(ctx) {
    setRequestId(ctx);
    const filters = buildFilters(ctx.query);

    try {
      const entries = await strapi
        .documents('plugin::erp-session-manager.erp-session-audit-log')
        .findMany({ filters, sort: { timestamp: 'desc' }, limit: 10000 });

      const header = CSV_COLUMNS.join(',');
      const rows = entries.map((e) =>
        CSV_COLUMNS.map((col) => escapeCsvField(e[col])).join(',')
      );
      const csv = [header, ...rows].join('\n');

      ctx.set('Content-Type', 'text/csv; charset=utf-8');
      ctx.set('Content-Disposition', 'attachment; filename="erp-session-audit-logs.csv"');
      ctx.body = csv;
    } catch (err) {
      ctx.status = 500;
      ctx.body = envelopeError(500, 'InternalServerError', err.message);
    }
  },
});
