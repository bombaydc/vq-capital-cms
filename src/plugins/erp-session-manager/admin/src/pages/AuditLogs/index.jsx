import { useState } from 'react';
import { Box, Flex, Typography, Alert, Status } from '@strapi/design-system';
import { useAuditLogs } from '../../hooks/useAuditLogs.js';
import { useApiClient } from '../../api/client.js';
import FilterBar from './FilterBar.jsx';
import AuditTable from './AuditTable.jsx';

const exportLogsCsv = (logs) => {
  const headers = ['Timestamp','Event Type','User','Session ID','IP Address','User-Agent','Outcome'];
  const rows = logs.map(log => [
    log.timestamp ? new Date(log.timestamp).toISOString() : '',
    log.eventType || '',
    log.userEmail || (log.userId ? `User #${log.userId}` : 'unknown'),
    log.sessionId ? log.sessionId.slice(0, 8) : '',
    log.ipAddress || '',
    log.userAgent || '',
    log.outcome || '',
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

const AuditLogsPage = () => {
  const [filters, setFilters] = useState({});
  const [page, setPage]       = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const client = useApiClient();

  const queryParams = {
    page, pageSize,
    ...(filters.email ? { email: filters.email } : {}),
    ...(filters.ip    ? { ipAddress: filters.ip } : {}),
    ...(filters.outcome && filters.outcome !== 'all' ? { outcome: filters.outcome } : {}),
    ...(filters.eventTypes?.length ? { eventType: filters.eventTypes.join(',') } : {}),
    ...(filters.from  ? { from: filters.from } : {}),
    ...(filters.to    ? { to: filters.to }     : {}),
  };

  const { logs, pagination, loading, error } = useAuditLogs(queryParams);

  const retentionDays = 90;
  const nextCleanup = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  const handleExportCsv = async () => {
    try {
      const { data } = await client.exportAuditLogs(queryParams);
      if (typeof data === 'string') {
        const blob = new Blob([data], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        exportLogsCsv(logs);
      }
    } catch {
      exportLogsCsv(logs);
    }
  };

  return (
    <Box>
      {/* Retention indicator */}
      <Box marginBottom={4}>
        <Status variant="secondary" size="S">
          <span>Retention: {retentionDays} days — Next cleanup: {nextCleanup}</span>
        </Status>
      </Box>

      <FilterBar
        onFilterChange={(f) => { setFilters(f); setPage(1); }}
        onExportCsv={handleExportCsv}
      />

      {error && (
        <Box marginBottom={4}>
          <Alert closeLabel="Close" title="Error" variant="danger" onClose={() => {}}>
            Failed to load audit logs: {error.message}
          </Alert>
        </Box>
      )}

      {loading && (
        <Box paddingTop={2} paddingBottom={2}>
          <Typography variant="omega" textColor="neutral500">Loading audit logs…</Typography>
        </Box>
      )}

      <AuditTable
        logs={logs}
        pagination={pagination}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
      />

      {/* Legend */}
      <Box marginTop={6} background="neutral0" borderRadius="4px" padding={4} shadow="filterShadow">
        <Typography variant="sigma" textColor="neutral500" textTransform="uppercase">
          Event Type Legend
        </Typography>
        <Flex gap={4} marginTop={3} wrap="wrap">
          <Flex gap={2} alignItems="center">
            <Box background="success100" borderRadius="4px" padding={1}>
              <Typography variant="sigma" textColor="success700">●</Typography>
            </Box>
            <Typography variant="omega" textColor="neutral600">Success events</Typography>
          </Flex>
          <Flex gap={2} alignItems="center">
            <Box background="warning100" borderRadius="4px" padding={1}>
              <Typography variant="sigma" textColor="warning700">●</Typography>
            </Box>
            <Typography variant="omega" textColor="neutral600">Session lifecycle</Typography>
          </Flex>
          <Flex gap={2} alignItems="center">
            <Box background="danger100" borderRadius="4px" padding={1}>
              <Typography variant="sigma" textColor="danger700">●</Typography>
            </Box>
            <Typography variant="omega" textColor="neutral600">Failure / anomaly</Typography>
          </Flex>
        </Flex>
      </Box>
    </Box>
  );
};

export default AuditLogsPage;
