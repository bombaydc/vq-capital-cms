import {
  Table, Thead, Tbody, Tr, Th, Td,
  Typography, Badge, Flex, Box,
} from '@strapi/design-system';

const METHOD_COLORS = {
  GET:    'secondary',
  POST:   'success',
  PUT:    'warning',
  PATCH:  'warning',
  DELETE: 'danger',
};

function statusColor(code) {
  if (!code) return 'neutral';
  if (code < 300) return 'success';
  if (code < 500) return 'warning';
  return 'danger';
}

function truncate(str, len = 12) {
  if (!str) return '—';
  return str.length > len ? `${str.slice(0, len)}…` : str;
}

function formatDate(val) {
  if (!val) return '—';
  return new Date(val).toLocaleString();
}

const ActivityTable = ({ logs, activityLoggingEnabled }) => {
  if (!activityLoggingEnabled) {
    return (
      <Box padding={6} textAlign="center">
        <Typography variant="omega" textColor="neutral500">
          Activity logging is disabled. Enable it in the Security Policy tab.
        </Typography>
      </Box>
    );
  }

  if (!logs || logs.length === 0) {
    return (
      <Box padding={6} textAlign="center">
        <Typography variant="omega" textColor="neutral500">No activity logs found.</Typography>
      </Box>
    );
  }

  // The Request Body column carries a JSON blob, so the table can be wider than
  // the panel. Scroll it inside its own box rather than letting the whole page
  // scroll sideways.
  return (
    <Box overflow="auto" maxWidth="100%">
      <Table colCount={7} rowCount={logs.length}>
      <Thead>
        <Tr>
          <Th><Typography variant="sigma">Session ID</Typography></Th>
          <Th><Typography variant="sigma">User ID</Typography></Th>
          <Th><Typography variant="sigma">Method</Typography></Th>
          <Th><Typography variant="sigma">URL</Typography></Th>
          <Th><Typography variant="sigma">Request Body</Typography></Th>
          <Th><Typography variant="sigma">Status</Typography></Th>
          <Th><Typography variant="sigma">Logged At</Typography></Th>
        </Tr>
      </Thead>
      <Tbody>
        {logs.map((log) => (
          <Tr key={log.id || log.documentId || `${log.sessionId}-${log.loggedAt}`}>
            <Td>
              <Typography variant="omega" title={log.sessionId}>
                {truncate(log.sessionId, 12)}
              </Typography>
            </Td>
            <Td>
              <Typography variant="omega">{log.userId || '—'}</Typography>
            </Td>
            <Td>
              <Badge active backgroundColor={`${METHOD_COLORS[log.method] || 'neutral'}100`}>
                {log.method || '—'}
              </Badge>
            </Td>
            <Td>
              <Typography variant="omega" title={log.url}>
                {truncate(log.url, 48)}
              </Typography>
            </Td>
            <Td>
              {/* Secrets arrive as enc:v1:… and PII pre-masked — the server
                  never sends readable credentials here. Rendered as text, so
                  a stored payload cannot execute. */}
              <Box maxWidth="320px">
                <Typography variant="omega" title={log.requestBody || ''} textColor="neutral600" ellipsis>
                  {truncate(log.requestBody, 60)}
                </Typography>
              </Box>
            </Td>
            <Td>
              <Badge backgroundColor={`${statusColor(log.statusCode)}100`}>
                {log.statusCode || '—'}
              </Badge>
            </Td>
            <Td>
              <Typography variant="omega">{formatDate(log.loggedAt)}</Typography>
            </Td>
          </Tr>
        ))}
      </Tbody>
      </Table>
    </Box>
  );
};

export default ActivityTable;
