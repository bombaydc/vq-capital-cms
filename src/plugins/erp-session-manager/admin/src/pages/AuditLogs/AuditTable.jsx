import {
  Box, Flex, Typography, Badge,
  Table, Thead, Tbody, Tr, Th, Td,
  Pagination, PreviousLink, NextLink, PageLink, Dots,
  EmptyStateLayout, Tooltip, SingleSelect, SingleSelectOption,
} from '@strapi/design-system';
import { CheckCircle } from '@strapi/icons';

const truncate = (str, max) => {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max) + '…' : str;
};

const formatDate = (ts) => {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
};

// Colour categories for event types
const EVENT_COLORS = {
  LOGIN_SUCCESS:    { bg: 'success100', text: 'success700' },
  TOKEN_REFRESH:    { bg: 'success100', text: 'success700' },
  LOGOUT:           { bg: 'success100', text: 'success700' },
  PASSWORD_CHANGED: { bg: 'success100', text: 'success700' },

  SESSION_EXPIRED:  { bg: 'warning100', text: 'warning700' },
  SESSION_EVICTED:  { bg: 'warning100', text: 'warning700' },
  SESSION_REVOKED:  { bg: 'warning100', text: 'warning700' },

  LOGIN_FAILURE:                    { bg: 'danger100', text: 'danger700' },
  ANOMALY_IP_CHANGE:                { bg: 'danger100', text: 'danger700' },
  ANOMALY_UA_CHANGE:                { bg: 'danger100', text: 'danger700' },
  ANOMALY_IMPOSSIBLE_TRAVEL:        { bg: 'danger100', text: 'danger700' },
  TOKEN_REUSE_ATTEMPT:              { bg: 'danger100', text: 'danger700' },
  REVOKED_TOKEN_USE:                { bg: 'danger100', text: 'danger700' },
  LOGIN_REJECTED_CONCURRENT_LIMIT:  { bg: 'danger100', text: 'danger700' },
  PASSWORD_REJECTED:                { bg: 'danger100', text: 'danger700' },
};

const EventBadge = ({ eventType }) => {
  const { bg, text } = EVENT_COLORS[eventType] || { bg: 'neutral150', text: 'neutral600' };
  return (
    <Box background={bg} borderRadius="4px" paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} display="inline-flex">
      <Typography variant="sigma" textColor={text}>{eventType}</Typography>
    </Box>
  );
};

const OutcomeBadge = ({ outcome }) => {
  const isSuccess = outcome === 'SUCCESS';
  return (
    <Box
      background={isSuccess ? 'success100' : 'danger100'}
      borderRadius="4px"
      paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}
      display="inline-flex"
    >
      <Typography variant="sigma" textColor={isSuccess ? 'success700' : 'danger700'}>
        {outcome}
      </Typography>
    </Box>
  );
};

const AuditTable = ({
  logs = [],
  pagination = { page: 1, pageSize: 25, total: 0, pageCount: 0 },
  onPageChange,
  onPageSizeChange,
}) => (
  <Box>
    <Box background="neutral0" borderRadius="4px" shadow="filterShadow" overflow="hidden">
      <Table colCount={7} rowCount={logs.length + 1}>
        <Thead>
          <Tr>
            <Th><Typography variant="sigma" textColor="neutral600">Timestamp</Typography></Th>
            <Th><Typography variant="sigma" textColor="neutral600">Event Type</Typography></Th>
            <Th><Typography variant="sigma" textColor="neutral600">User</Typography></Th>
            <Th><Typography variant="sigma" textColor="neutral600">Session ID</Typography></Th>
            <Th><Typography variant="sigma" textColor="neutral600">IP Address</Typography></Th>
            <Th><Typography variant="sigma" textColor="neutral600">User-Agent</Typography></Th>
            <Th><Typography variant="sigma" textColor="neutral600">Outcome</Typography></Th>
          </Tr>
        </Thead>
        <Tbody>
          {logs.length === 0 ? (
            <Tr>
              <Td colSpan={7}>
                <EmptyStateLayout
                  icon={<CheckCircle width="4rem" height="4rem" fill="neutral400" />}
                  content="No audit log entries found."
                />
              </Td>
            </Tr>
          ) : logs.map((log, idx) => (
            <Tr key={log.id || idx}>
              <Td>
                <Typography variant="omega" textColor="neutral600" style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                  {formatDate(log.timestamp)}
                </Typography>
              </Td>
              <Td><EventBadge eventType={log.eventType} /></Td>
              <Td>
                <Typography variant="omega" textColor="neutral800">
                  {log.userEmail || (log.userId ? `User #${log.userId}` : 'unknown')}
                </Typography>
              </Td>
              <Td>
                <Typography variant="omega" textColor="neutral600" style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                  {log.sessionId ? log.sessionId.slice(0, 8) : '—'}
                </Typography>
              </Td>
              <Td><Typography variant="omega" textColor="neutral800">{log.ipAddress || '—'}</Typography></Td>
              <Td>
                <Tooltip label={log.userAgent || ''}>
                  <Typography variant="omega" textColor="neutral800">{truncate(log.userAgent, 40)}</Typography>
                </Tooltip>
              </Td>
              <Td><OutcomeBadge outcome={log.outcome} /></Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Box>

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
            {[10, 25, 50, 100].map(n => <SingleSelectOption key={n} value={String(n)}>{n} per page</SingleSelectOption>)}
          </SingleSelect>
        </Box>
      </Flex>
    )}
  </Box>
);

export default AuditTable;
