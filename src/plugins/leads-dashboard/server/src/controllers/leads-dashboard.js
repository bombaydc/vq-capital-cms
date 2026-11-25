'use strict';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Must match the keys of COLLECTIONS in services/leads-report.js.
const COLLECTION_KEYS = ['contact'];

function isValidDate(str) {
  if (!ISO_DATE_RE.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Round-trip check — rejects rollover dates like 2026-06-31 that
  // new Date() would silently coerce to 2026-07-01.
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function daysBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function validateDateRange(ctx) {
  const { startDate, endDate } = ctx.query;
  if (!startDate || !endDate) {
    ctx.badRequest('startDate and endDate are required');
    return false;
  }
  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    ctx.badRequest('startDate and endDate must be valid dates (YYYY-MM-DD)');
    return false;
  }
  if (startDate > endDate) {
    ctx.badRequest('startDate must be on or before endDate');
    return false;
  }
  if (daysBetween(startDate, endDate) > 366) {
    ctx.badRequest('Date range must not exceed 366 days');
    return false;
  }
  return true;
}

module.exports = ({ strapi }) => ({
  async rangeStats(ctx) {
    if (!validateDateRange(ctx)) return;
    const { startDate, endDate } = ctx.query;
    const stats = await strapi
      .plugin('leads-dashboard')
      .service('leadsReport')
      .getStatsForRange({ startDate, endDate });
    ctx.body = stats;
  },

  async exportRange(ctx) {
    if (!validateDateRange(ctx)) return;
    const { startDate, endDate, collection } = ctx.query;
    if (collection !== undefined && !COLLECTION_KEYS.includes(collection)) {
      ctx.badRequest(`collection must be one of: ${COLLECTION_KEYS.join(', ')}`);
      return;
    }
    const service = strapi.plugin('leads-dashboard').service('leadsReport');
    const { buffer, filename } = await service.buildRangeExcel({
      startDate,
      endDate,
      collection: collection || null,
    });
    ctx.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    ctx.set('Content-Disposition', `attachment; filename="${filename}"`);
    ctx.body = buffer;
  },
});
