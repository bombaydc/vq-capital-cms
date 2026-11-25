import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Box, Flex, Typography, Button, IconButton,
  Table, Thead, Tbody, Tr, Th, Td,
  Pagination, PreviousLink, NextLink, PageLink, Dots,
  EmptyStateLayout, SingleSelect, SingleSelectOption,
} from '@strapi/design-system';
import { Trash, Eye, ArrowDown, WarningCircle, CheckCircle } from '@strapi/icons';

const truncate = (str, max) => {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max) + '…' : str;
};

const formatDate = (ts) => {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
};

const getLocation = (s) => {
  const g = s.geoLocation;
  if (!g) return 'Unknown';
  return [g.city, g.country].filter(Boolean).join(', ') || 'Unknown';
};

const getStatus = (session) => {
  if (session.isRevoked) return 'revoked';
  if (session.anomalyFlags?.length) return 'anomaly';
  const now = Date.now();
  if (session.expiresAt && session.expiresAt - now < 30 * 60 * 1000) return 'expiring';
  return 'active';
};

const StatusBadge = ({ session }) => {
  const status = getStatus(session);
  const map = {
    active:   { label: 'Active',     bg: '#d9f0d3', color: '#1a6b2e' },
    anomaly:  { label: '⚠ Anomaly',  bg: '#fdf0d3', color: '#7a4f00' },
    expiring: { label: '⏱ Expiring', bg: '#dce5ff', color: '#2a3eb1' },
    revoked:  { label: 'Revoked',    bg: '#f0f0f0', color: '#666' },
  };
  const { label, bg, color } = map[status] || map.active;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '4px',
      fontSize: '0.75rem',
      fontWeight: 600,
      background: bg,
      color,
    }}>
      {label}
    </span>
  );
};

const exportCsv = (sessions) => {
  const headers = ['User', 'Session ID', 'IP Address', 'Location', 'User-Agent', 'Login Time', 'Last Active', 'Expires At', 'Status'];
  const rows = sessions.map(s => [
    s.userEmail || s.userId || '',
    (s.sessionId || '').slice(0, 8),
    s.ipAddress || '',
    getLocation(s),
    s.userAgent || '',
    formatDate(s.issuedAt),
    formatDate(s.lastActive),
    formatDate(s.expiresAt),
    getStatus(s),
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sessions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// Plain checkbox to avoid Radix AccessibleIcon onlyChild issues
const PlainCheckbox = ({ checked, indeterminate, onChange, disabled, label }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={e => onChange?.(e.target.checked)}
      disabled={disabled}
      aria-label={label}
      style={{ cursor: disabled ? 'not-allowed' : 'pointer', width: '16px', height: '16px' }}
    />
  );
};

const SessionTable = ({
  sessions = [],
  pagination = { page: 1, pageSize: 25, total: 0, pageCount: 0 },
  onRevoke,
  onViewDetails,
  onRevokeSelected,
  onRevokeAllForUser,
  onPageChange,
  onPageSizeChange,
  revokedIds = new Set(),
}) => {
  const [selected, setSelected] = useState(new Set());

  const toggleAll = useCallback((checked) => {
    setSelected(checked ? new Set(sessions.map(s => s.sessionId)) : new Set());
  }, [sessions]);

  const toggleOne = useCallback((id, checked) => {
    setSelected(prev => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  }, []);

  const allChecked = sessions.length > 0 && sessions.every(s => selected.has(s.sessionId));
  const someChecked = selected.size > 0 && !allChecked;

  return (
    <Box>
      {/* Bulk actions */}
      <Flex gap={2} marginBottom={3} justifyContent="space-between" wrap="wrap">
        <Button
          variant="danger-light"
          startIcon={<Trash />}
          disabled={selected.size === 0}
          onClick={() => { onRevokeSelected?.(Array.from(selected)); setSelected(new Set()); }}
          size="S"
        >
          Revoke Selected ({selected.size})
        </Button>
        <Button
          variant="tertiary"
          startIcon={<ArrowDown />}
          onClick={() => exportCsv(sessions)}
          size="S"
        >
          Export CSV
        </Button>
      </Flex>

      {/* Table */}
      <Box background="neutral0" borderRadius="4px" shadow="filterShadow" overflow="hidden">
        <Table colCount={11} rowCount={sessions.length + 1}>
          <Thead>
            <Tr>
              <Th>
                <PlainCheckbox
                  checked={allChecked}
                  indeterminate={someChecked}
                  onChange={toggleAll}
                  label="Select all sessions"
                />
              </Th>
              <Th><Typography variant="sigma" textColor="neutral600">User</Typography></Th>
              <Th><Typography variant="sigma" textColor="neutral600">Session ID</Typography></Th>
              <Th><Typography variant="sigma" textColor="neutral600">IP Address</Typography></Th>
              <Th><Typography variant="sigma" textColor="neutral600">Location</Typography></Th>
              <Th><Typography variant="sigma" textColor="neutral600">User-Agent</Typography></Th>
              <Th><Typography variant="sigma" textColor="neutral600">Login Time</Typography></Th>
              <Th><Typography variant="sigma" textColor="neutral600">Last Active</Typography></Th>
              <Th><Typography variant="sigma" textColor="neutral600">Expires At</Typography></Th>
              <Th><Typography variant="sigma" textColor="neutral600">Status</Typography></Th>
              <Th><Typography variant="sigma" textColor="neutral600">Actions</Typography></Th>
            </Tr>
          </Thead>
          <Tbody>
            {sessions.length === 0 ? (
              <Tr>
                <Td colSpan={11}>
                  <EmptyStateLayout
                    icon={<CheckCircle width="4rem" height="4rem" fill="neutral400" />}
                    content="No sessions found."
                  />
                </Td>
              </Tr>
            ) : sessions.map(session => {
              const isRevoked = revokedIds.has(session.sessionId);
              return (
                <Tr key={session.sessionId} style={{ opacity: isRevoked ? 0.5 : 1 }}>
                  <Td>
                    <PlainCheckbox
                      checked={selected.has(session.sessionId)}
                      onChange={checked => toggleOne(session.sessionId, checked)}
                      disabled={isRevoked}
                      label={`Select session ${session.sessionId?.slice(0, 8)}`}
                    />
                  </Td>
                  <Td>
                    <Typography variant="omega" textColor="neutral800">
                      {session.userEmail || `User #${session.userId}`}
                    </Typography>
                  </Td>
                  <Td>
                    <Typography variant="omega" textColor="neutral600" style={{ fontFamily: 'monospace' }}>
                      {(session.sessionId || '').slice(0, 8)}
                    </Typography>
                  </Td>
                  <Td>
                    <Typography variant="omega" textColor="neutral800">{session.ipAddress || '—'}</Typography>
                  </Td>
                  <Td>
                    <Typography variant="omega" textColor="neutral800">{getLocation(session)}</Typography>
                  </Td>
                  <Td title={session.userAgent || ''}>
                    <Typography variant="omega" textColor="neutral800">
                      {truncate(session.userAgent, 40)}
                    </Typography>
                  </Td>
                  <Td>
                    <Typography variant="omega" textColor="neutral800">{formatDate(session.issuedAt)}</Typography>
                  </Td>
                  <Td>
                    <Typography variant="omega" textColor="neutral800">{formatDate(session.lastActive)}</Typography>
                  </Td>
                  <Td>
                    <Typography variant="omega" textColor="neutral800">{formatDate(session.expiresAt)}</Typography>
                  </Td>
                  <Td><StatusBadge session={session} /></Td>
                  <Td>
                    <Flex gap={1}>
                      <IconButton label="View details" onClick={() => onViewDetails?.(session)} variant="ghost">
                        <Eye />
                      </IconButton>
                      {!isRevoked && !session.isRevoked && (
                        <>
                          <IconButton label="Revoke session" onClick={() => onRevoke?.(session.sessionId)} variant="ghost">
                            <Trash />
                          </IconButton>
                          <IconButton label="Revoke all for user" onClick={() => onRevokeAllForUser?.(session.userId)} variant="ghost">
                            <WarningCircle />
                          </IconButton>
                        </>
                      )}
                    </Flex>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </Box>

      {/* Pagination */}
      {pagination.pageCount > 1 && (
        <Flex justifyContent="space-between" alignItems="center" marginTop={4} wrap="wrap" gap={2}>
          <Typography variant="omega" textColor="neutral600">
            {pagination.total > 0
              ? `${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(pagination.page * pagination.pageSize, pagination.total)} of ${pagination.total}`
              : 'No results'}
          </Typography>
          <Pagination activePage={pagination.page} pageCount={pagination.pageCount}>
            <PreviousLink onClick={() => onPageChange?.(pagination.page - 1)}>Previous</PreviousLink>
            {Array.from({ length: Math.min(pagination.pageCount, 5) }, (_, i) => i + 1).map(p => (
              <PageLink key={p} number={p} onClick={() => onPageChange?.(p)}>{p}</PageLink>
            ))}
            {pagination.pageCount > 5 && <Dots />}
            <NextLink onClick={() => onPageChange?.(pagination.page + 1)}>Next</NextLink>
          </Pagination>
          <Box minWidth="120px">
            <SingleSelect label="" value={String(pagination.pageSize)} onChange={v => onPageSizeChange?.(Number(v))} size="S">
              {[10, 25, 50, 100].map(n => (
                <SingleSelectOption key={n} value={String(n)}>{n} per page</SingleSelectOption>
              ))}
            </SingleSelect>
          </Box>
        </Flex>
      )}
    </Box>
  );
};

export default SessionTable;
