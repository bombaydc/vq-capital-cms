import React, { useState, useEffect } from 'react';
import { useTheme } from 'styled-components';
import { Page, Layouts, useRBAC, useFetchClient } from '@strapi/strapi/admin';
import {
  Main,
  Box,
  Flex,
  Grid,
  Typography,
  Button,
  Loader,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  EmptyStateLayout,
} from '@strapi/design-system';
import { ChartPie, Download, User, Store, Mail, PresentationChart, Filter, Rocket } from '@strapi/icons';
import dashboardPermissions from '../permissions.js';

function fetchExportBlob(url, token) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response);
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const body = JSON.parse(reader.result);
            reject(new Error(body?.error?.message || `Export failed (${xhr.status})`));
          } catch {
            reject(new Error(`Export failed (${xhr.status})`));
          }
        };
        reader.readAsText(xhr.response);
      }
    };
    xhr.onerror = () => reject(new Error('Network error during export'));
    xhr.send();
  });
}

const COLLECTIONS = [
  {
    key: 'contact',
    label: 'Lead Contact',
    icon: User,
    fileSlug: 'lead-contacts',
    breakdowns: [
      { key: 'byQueryType', title: 'By Nature of Enquiry' },
      { key: 'byCountry', title: 'By Country' },
    ],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDefaultDates() {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 29);
  return {
    startDate: from.toISOString().slice(0, 10),
    endDate: today.toISOString().slice(0, 10),
  };
}

function isValidDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

import PropTypes from 'prop-types';

function fmtDisplay(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${months[Number.parseInt(m, 10) - 1]} ${y}`;
}

function fmtShort(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${months[Number.parseInt(m, 10) - 1]}`;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, icon: Icon, primary = false }) {
  const theme = useTheme();
  const c = theme.colors;
  return (
    <div style={{
      background: c.neutral0,
      border: `1px solid ${c.neutral150}`,
      borderRadius: 4,
      boxShadow: theme.shadows.tableShadow,
      padding: '20px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      width: '100%',
      boxSizing: 'border-box',
      borderTop: primary ? `3px solid ${c.primary600}` : `3px solid transparent`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{
          fontSize: '1.1rem',
          fontWeight: 600,
          color: c.neutral500,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          {label}
        </span>
        {Icon && (
          <div style={{
            width: 32,
            height: 32,
            borderRadius: 4,
            background: primary ? c.primary100 : c.neutral100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Icon fill={primary ? c.primary600 : c.neutral400} width="16px" height="16px" />
          </div>
        )}
      </div>
      <span style={{
        fontSize: '3.2rem',
        fontWeight: 700,
        color: primary ? c.primary600 : c.neutral800,
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </span>
    </div>
  );
}

KpiCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  icon: PropTypes.elementType,
  primary: PropTypes.bool,
};

// ─── Bar Row + Breakdown list ─────────────────────────────────────────────────

function BarRow({ name, count, pct, rank }) {
  const theme = useTheme();
  const c = theme.colors;
  const barColors = [c.primary600, c.primary500, '#9795ff', c.neutral300, c.neutral300];
  const barColor = barColors[Math.min(rank, barColors.length - 1)];

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 5,
      }}>
        <span style={{
          fontSize: '1.3rem',
          fontWeight: rank === 0 ? 600 : 400,
          color: c.neutral800,
          maxWidth: '60%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {name || '—'}
        </span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span style={{ fontSize: '1.3rem', fontWeight: 600, color: c.neutral800 }}>{count}</span>
          <span style={{ fontSize: '1.1rem', color: c.neutral400 }}>{pct}%</span>
        </span>
      </div>
      <div style={{ height: 6, background: c.neutral150, borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${Math.max(pct > 0 ? 2 : 0, pct)}%`,
          background: barColor,
          borderRadius: 99,
          transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
        }} />
      </div>
    </div>
  );
}

BarRow.propTypes = {
  name: PropTypes.string,
  count: PropTypes.number.isRequired,
  pct: PropTypes.number.isRequired,
  rank: PropTypes.number.isRequired,
};

function BreakdownList({ rows, total }) {
  const theme = useTheme();
  if (!rows || rows.length === 0) {
    return (
      <span style={{ fontSize: '1.3rem', color: theme.colors.neutral400 }}>
        No data for this period.
      </span>
    );
  }
  return (
    <div>
      {rows.map((r, i) => (
        <BarRow
          key={i}
          name={r.value}
          count={r.count}
          pct={total > 0 ? Math.round((r.count / total) * 100) : 0}
          rank={i}
        />
      ))}
    </div>
  );
}

// ─── Daily Table ──────────────────────────────────────────────────────────────

function DailyTable({ rows }) {
  const theme = useTheme();
  const c = theme.colors;
  if (!rows || rows.length === 0) {
    return (
      <span style={{ fontSize: '1.3rem', color: c.neutral400 }}>
        No data for this period.
      </span>
    );
  }
  const maxCount = Math.max(...rows.map((r) => r.count), 1);
  return (
    <Table colCount={2} rowCount={rows.length}>
      <Thead>
        <Tr>
          <Th><Typography variant="sigma" textColor="neutral600">Date</Typography></Th>
          <Th><Typography variant="sigma" textColor="neutral600">Leads</Typography></Th>
        </Tr>
      </Thead>
      <Tbody>
        {rows.map((r, i) => (
          <Tr key={i}>
            <Td>
              <Typography variant="omega" textColor="neutral700">{fmtShort(r.date)}</Typography>
            </Td>
            <Td>
              <Flex alignItems="center" gap={3} style={{ overflow: 'hidden' }}>
                <Typography variant="omega" fontWeight="semiBold" textColor="neutral800">
                  {r.count}
                </Typography>
                <div style={{
                  height: 6,
                  flex: '1 1 auto',
                  maxWidth: 80,
                  minWidth: 4,
                  background: c.neutral150,
                  borderRadius: 99,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.round((r.count / maxCount) * 100)}%`,
                    background: c.primary200,
                    borderRadius: 99,
                  }} />
                </div>
              </Flex>
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}

// ─── Collection Card — self-contained: own breakdowns, own daily counts,
//     own export CTA. Data from other collections never appears here. ────────

function CollectionCard({ meta, stats, canExport, exporting, onExport, loading }) {
  const theme = useTheme();
  const c = theme.colors;
  const Icon = meta.icon;
  const total = stats?.total ?? 0;

  return (
    <div style={{
      background: c.neutral0,
      border: `1px solid ${c.neutral150}`,
      borderRadius: 4,
      boxShadow: theme.shadows.tableShadow,
      width: '100%',
      boxSizing: 'border-box',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 20px',
        borderBottom: `1px solid ${c.neutral150}`,
        flexWrap: 'wrap',
      }}>
        <Icon fill={c.neutral400} width="14px" height="14px" aria-hidden />
        <span style={{
          fontSize: '1.1rem',
          fontWeight: 600,
          color: c.neutral500,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          {meta.label}
        </span>
        <span style={{
          marginLeft: 'auto',
          fontSize: '1.2rem',
          fontWeight: 600,
          color: c.primary600,
          background: c.primary100,
          padding: '2px 12px',
          borderRadius: 99,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {total.toLocaleString()} lead{total !== 1 ? 's' : ''}
        </span>
        {canExport && (
          <Button
            variant="secondary"
            size="S"
            startIcon={<Download />}
            onClick={() => onExport(meta)}
            loading={exporting}
            disabled={loading || total === 0}
          >
            Export
          </Button>
        )}
      </div>

      {total === 0 ? (
        <div style={{ padding: '24px 20px', textAlign: 'center' }}>
          <span style={{ fontSize: '1.3rem', color: c.neutral400 }}>
            No {meta.label.toLowerCase()} leads for this period.
          </span>
        </div>
      ) : (
        <Grid.Root gap={0} style={{ width: '100%' }}>
          {meta.breakdowns.map((b) => (
            <Grid.Item key={b.key} col={4} s={12} style={{ width: '100%', alignItems: 'flex-start' }}>
              <div style={{
                padding: '16px 20px',
                borderRight: `1px solid ${c.neutral150}`,
                width: '100%',
                boxSizing: 'border-box',
                alignSelf: 'stretch',
              }}>
                <p style={{
                  margin: '0 0 12px',
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  color: c.neutral400,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}>
                  {b.title}
                </p>
                <BreakdownList rows={stats[b.key]} total={total} />
              </div>
            </Grid.Item>
          ))}
          <Grid.Item col={meta.breakdowns.length > 0 ? 4 : 12} s={12} style={{ width: '100%', alignItems: 'flex-start' }}>
            <div style={{ padding: '16px 20px 8px', width: '100%', boxSizing: 'border-box' }}>
              <p style={{
                margin: '0 0 8px',
                fontSize: '1.1rem',
                fontWeight: 600,
                color: c.neutral400,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}>
                Daily Counts
              </p>
              <DailyTable rows={stats.dailyCounts} />
            </div>
          </Grid.Item>
        </Grid.Root>
      )}
    </div>
  );
}

// ─── Date Input ───────────────────────────────────────────────────────────────

function DateInput({ label, value, min, max, onChange }) {
  const theme = useTheme();
  const c = theme.colors;
  const [focused, setFocused] = React.useState(false);
  return (
    <Box>
      <Typography
        variant="pi"
        fontWeight="bold"
        textColor="neutral800"
        style={{ display: 'block', marginBottom: 4 }}
      >
        {label}
      </Typography>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          height: 36,
          padding: '0 12px',
          border: `1px solid ${focused ? c.primary600 : c.neutral200}`,
          borderRadius: 4,
          fontSize: '1.4rem',
          color: c.neutral800,
          background: c.neutral0,
          fontFamily: 'inherit',
          outline: 'none',
          cursor: 'pointer',
          minWidth: 140,
          colorScheme: 'auto',
        }}
      />
    </Box>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LeadsDashboardPage() {
  const defaults = getDefaultDates();
  const params = new URLSearchParams(window.location.search);
  const initStart = isValidDate(params.get('startDate')) ? params.get('startDate') : defaults.startDate;
  const initEnd = isValidDate(params.get('endDate')) ? params.get('endDate') : defaults.endDate;

  const [startDate, setStartDate] = useState(initStart);
  const [endDate, setEndDate] = useState(initEnd);
  const [appliedRange, setAppliedRange] = useState({ startDate: initStart, endDate: initEnd });
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [exportingKey, setExportingKey] = useState(null); // 'all' | collection key | null

  const theme = useTheme();
  const c = theme.colors;
  const { get } = useFetchClient();
  const { allowedActions } = useRBAC(dashboardPermissions.export);
  const canExport = allowedActions.canExport;

  const fetchStats = async (start, end) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await get(`/leads-dashboard/dashboard?startDate=${start}&endDate=${end}`);
      setStats(data);
      setAppliedRange({ startDate: start, endDate: end });
      window.history.replaceState({}, '', `/admin/plugins/leads-dashboard?startDate=${start}&endDate=${end}`);
    } catch (err) {
      setError(err?.response?.data?.error?.message || err?.message || 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchStats(initStart, initEnd); }, []);

  const handleApply = () => {
    if (!isValidDate(startDate) || !isValidDate(endDate)) { setError('Enter valid dates (YYYY-MM-DD).'); return; }
    if (startDate > endDate) { setError('Start date must be on or before end date.'); return; }
    fetchStats(startDate, endDate);
  };

  // meta null → all collections (one workbook, one sheet per collection);
  // meta set → that collection only, as its own file.
  const handleExport = async (meta = null) => {
    const range = appliedRange;
    setExportingKey(meta ? meta.key : 'all');
    setError(null);
    try {
      const getToken = () => {
        try {
          const raw = localStorage.getItem('jwtToken');
          if (raw !== null) return JSON.parse(raw);
        } catch {}
        try {
          const match = document.cookie.split(';').find(c => c.trim().startsWith('jwtToken='));
          if (match) return decodeURIComponent(match.split('=')[1].trim());
        } catch {}
        return null;
      };

      const token = getToken();
      const base = (window.strapi && window.strapi.backendURL) || '';
      const collectionParam = meta ? `&collection=${meta.key}` : '';
      const url = `${base}/leads-dashboard/export-range?startDate=${range.startDate}&endDate=${range.endDate}${collectionParam}`;

      const blob = await fetchExportBlob(url, token);

      const filename = meta
        ? `${meta.fileSlug}-${range.startDate}-to-${range.endDate}.xlsx`
        : `leads-${range.startDate}-to-${range.endDate}.xlsx`;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err.message || 'Export failed');
    } finally {
      setExportingKey(null);
    }
  };

  const rangeLabel = `${fmtDisplay(appliedRange.startDate)} – ${fmtDisplay(appliedRange.endDate)}`;
  const subtitle = stats
    ? `${rangeLabel} · ${stats.total.toLocaleString()} lead${stats.total !== 1 ? 's' : ''}`
    : 'Lead statistics and Excel export for any date range';

  return (
    <Page.Protect permissions={dashboardPermissions.access}>
      <Main>
        <Page.Title>Leads Dashboard</Page.Title>

        <Layouts.Header
          title="Leads Dashboard"
          subtitle={subtitle}
          primaryAction={
            canExport ? (
              <Button
                startIcon={<Download />}
                onClick={() => handleExport(null)}
                loading={exportingKey === 'all'}
                disabled={loading || exportingKey !== null && exportingKey !== 'all'}
                size="S"
              >
                Export Excel
              </Button>
            ) : null
          }
        />

        <Layouts.Action
          startActions={
            <Flex gap={3} alignItems="flex-end">
              <DateInput label="Start date" value={startDate} max={endDate} onChange={setStartDate} />
              <DateInput label="End date" value={endDate} min={startDate} onChange={setEndDate} />
              <Button startIcon={<Filter />} onClick={handleApply} loading={loading} size="S">
                Apply
              </Button>
            </Flex>
          }
        />

        <Layouts.Content>

          {error && (
            <Box
              background="danger100"
              hasRadius
              padding={4}
              marginBottom={6}
              style={{ borderLeft: `3px solid ${c.danger600}` }}
            >
              <Typography textColor="danger600" fontWeight="semiBold">{error}</Typography>
            </Box>
          )}

          {loading && (
            <Flex justifyContent="center" alignItems="center" style={{ minHeight: 300 }}>
              <Loader>Loading stats…</Loader>
            </Flex>
          )}

          {!loading && stats && stats.total === 0 && (
            <Box style={{ marginTop: 48, paddingBottom: 48 }}>
              <EmptyStateLayout
                icon={<ChartPie width="16rem" />}
                content={`No leads found for ${rangeLabel}.`}
              />
            </Box>
          )}

          {!loading && stats && stats.total > 0 && (
            <Flex direction="column" gap={5} paddingBottom={10} alignItems="stretch">

              {/* KPI row — the Total is the only cross-collection number */}
              <Grid.Root gap={4} style={{ width: '100%' }}>
                <Grid.Item col={3} s={6} xs={12} style={{ width: '100%' }}>
                  <KpiCard label="Total Leads" value={stats.total.toLocaleString()} icon={PresentationChart} primary />
                </Grid.Item>
                {COLLECTIONS.map((col) => (
                  <Grid.Item key={col.key} col={2} s={6} xs={12} style={{ width: '100%' }}>
                    <KpiCard label={col.label.replace('Lead ', '')} value={(stats[col.key]?.total ?? 0).toLocaleString()} icon={col.icon} />
                  </Grid.Item>
                ))}
              </Grid.Root>

              {/* One self-contained card per collection */}
              {COLLECTIONS.map((meta) => (
                <CollectionCard
                  key={meta.key}
                  meta={meta}
                  stats={stats[meta.key] ?? { total: 0, dailyCounts: [] }}
                  canExport={canExport}
                  exporting={exportingKey === meta.key}
                  onExport={handleExport}
                  loading={loading || (exportingKey !== null && exportingKey !== meta.key)}
                />
              ))}

            </Flex>
          )}
        </Layouts.Content>
      </Main>
    </Page.Protect>
  );
}
