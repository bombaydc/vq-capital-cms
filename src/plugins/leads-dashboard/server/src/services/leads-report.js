'use strict';

const ExcelJS = require('exceljs');
const { readPii } = require('../../../../../utility/pii-encryption');

// ─── Timezone handling ────────────────────────────────────────────────────────
// Dates arrive from Strapi's query engine as absolute instants, so IST day
// boundaries are computed explicitly and never depend on the host timezone.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Absolute instants of IST start-of-day / end-of-day.
function rangeBounds(startDate, endDate) {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const start = new Date(Date.UTC(sy, sm - 1, sd, 0, 0, 0, 0) - IST_OFFSET_MS);
  const end = new Date(Date.UTC(ey, em - 1, ed, 23, 59, 59, 999) - IST_OFFSET_MS);
  return { start, end };
}

// YYYY-MM-DD of an instant, in IST.
function istDateKey(value) {
  return new Date(new Date(value).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function fmtIstDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

// PII is stored AES-256-GCM (`v2:` prefix) since the encryption migration;
// rows written before it are still RSA-4096. readPii() routes each value to the
// right scheme, so both coexist and the legacy branch retires in one place.
//
// Failure → '-'. An undecryptable cell must never fall back to emitting the
// ciphertext into the spreadsheet.
function decryptField(value) {
  if (!value) return '-';
  const decrypted = readPii(value);
  return decrypted != null && decrypted !== '' ? decrypted : '-';
}

// ─── Per-collection definitions — data is never merged across these ──────────
const COLLECTIONS = {
  contact: {
    uid: 'api::lead-contact.lead-contact',
    table: 'lead_contacts',
    sheetName: 'Contacts',
    fileSlug: 'lead-contacts',
    breakdowns: [
      { key: 'byQueryType', column: 'query_type' },
      { key: 'byCountry', column: 'country' },
    ],
    columns: [
      '#', 'Name', 'Email', 'Country Code', 'Mobile', 'Country',
      'Nature of Enquiry', 'Details', 'Referer URL', 'Page URL', 'IP Address', 'Date & Time (IST)',
    ],
    toRow: (lead, i) => [
      i + 1,
      decryptField(lead.name),
      decryptField(lead.email),
      lead.country_code || '-',
      decryptField(lead.mobile),
      lead.country || '-',
      lead.query_type || '-',
      lead.message || '-',
      lead.referer_url || '-',
      lead.page_url || '-',
      lead.ipaddress || '-',
      fmtIstDateTime(lead.createdAt),
    ],
  },
};

module.exports = ({ strapi }) => ({
  // DB-agnostic (Postgres / MySQL / SQLite): rows are read through Strapi's
  // query engine — which handles datetimes the same way it wrote them — and
  // counted in JS. Only the columns needed for the stats are selected, and the
  // controller caps the range at 366 days, so the row count stays small.
  async collectionStats(cfg, start, end) {
    const columns = ['createdAt', ...cfg.breakdowns.map((b) => b.column)];
    const rows = await strapi.db.query(cfg.uid).findMany({
      select: columns,
      where: {
        createdAt: { $gte: start, $lte: end },
        publishedAt: { $notNull: true },
      },
    });

    const stats = { total: rows.length, dailyCounts: [] };

    for (const b of cfg.breakdowns) {
      const counts = new Map();
      for (const r of rows) {
        const v = r[b.column] ?? null;
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      stats[b.key] = [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b2) => b2.count - a.count);
    }

    const daily = new Map();
    for (const r of rows) {
      const day = istDateKey(r.createdAt);
      daily.set(day, (daily.get(day) || 0) + 1);
    }
    stats.dailyCounts = [...daily.entries()]
      .sort(([a], [b2]) => (a < b2 ? -1 : 1))
      .map(([date, count]) => ({ date, count }));

    return stats;
  },

  async getStatsForRange({ startDate, endDate }) {
    const { start, end } = rangeBounds(startDate, endDate);

    const result = { startDate, endDate, total: 0, byType: [] };
    for (const [type, cfg] of Object.entries(COLLECTIONS)) {
      const stats = await this.collectionStats(cfg, start, end);
      result[type] = stats;
      result.total += stats.total;
      result.byType.push({ type, count: stats.total });
    }
    return result;
  },

  async addCollectionSheet(workbook, cfg, start, end) {
    const leads = await strapi.db.query(cfg.uid).findMany({
      where: {
        createdAt: { $gte: start, $lte: end },
        publishedAt: { $notNull: true },
      },
      orderBy: { createdAt: 'asc' },
    });

    const sheet = workbook.addWorksheet(cfg.sheetName);
    sheet.addRow(cfg.columns);
    sheet.getRow(1).font = { bold: true };
    leads.forEach((lead, i) => sheet.addRow(cfg.toRow(lead, i)));
    return leads.length;
  },

  // collection: a COLLECTIONS key (currently only 'contact') → single-sheet workbook for
  // that collection only; null → one workbook, one sheet per collection.
  // Sheets are always per-collection — rows are never merged.
  async buildRangeExcel({ startDate, endDate, collection = null }) {
    const { start, end } = rangeBounds(startDate, endDate);
    const workbook = new ExcelJS.Workbook();

    let filename;
    if (collection) {
      const cfg = COLLECTIONS[collection];
      await this.addCollectionSheet(workbook, cfg, start, end);
      filename = `${cfg.fileSlug}-${startDate}-to-${endDate}.xlsx`;
    } else {
      for (const cfg of Object.values(COLLECTIONS)) {
        await this.addCollectionSheet(workbook, cfg, start, end);
      }
      filename = `leads-${startDate}-to-${endDate}.xlsx`;
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return { buffer: Buffer.from(arrayBuffer), filename };
  },
});
