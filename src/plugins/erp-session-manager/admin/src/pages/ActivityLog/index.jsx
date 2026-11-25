import { useState, useEffect } from 'react';
import {
  Box, Flex, Typography, Alert,
  Pagination, PreviousLink, NextLink, PageLink, Dots,
  SingleSelect, SingleSelectOption,
} from '@strapi/design-system';
import { useActivityLogs } from '../../hooks/useActivityLogs.js';
import { usePolicy } from '../../hooks/usePolicy.js';
import FilterBar from './FilterBar.jsx';
import ActivityTable from './ActivityTable.jsx';
import { buildPageList } from './pagination.js';

const DEFAULT_FILTERS = { sessionId: '', userId: '', method: '' };
const PAGE_SIZES = [25, 50, 100];

const ActivityLogPage = () => {
  const [filters, setFilters]   = useState(DEFAULT_FILTERS);
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const queryParams = {
    page,
    pageSize,
    ...(filters.sessionId ? { sessionId: filters.sessionId } : {}),
    ...(filters.userId    ? { userId: filters.userId }       : {}),
    ...(filters.method    ? { method: filters.method }       : {}),
  };

  const { logs, pagination, loading, error } = useActivityLogs(queryParams);
  const { policy } = usePolicy();

  const activityLoggingEnabled = policy?.activityLoggingEnabled ?? false;
  const pageCount = pagination.pageCount || 0;

  // A filter can shrink the result set below the current page, which would
  // otherwise leave the table empty with no way back except paging down.
  useEffect(() => {
    if (pageCount > 0 && page > pageCount) setPage(pageCount);
  }, [pageCount, page]);

  const handleFilterChange = (newFilters) => {
    setFilters(newFilters);
    setPage(1);
  };

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  };

  const handlePageSize = (value) => {
    setPageSize(Number(value));
    setPage(1);
  };

  const goTo = (target) => (event) => {
    event.preventDefault();          // the links are <a> with no real target
    setPage(Math.min(Math.max(1, target), Math.max(1, pageCount)));
  };

  const first = pagination.total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last  = Math.min(page * pageSize, pagination.total);

  return (
    <Box padding={8} background="neutral100" minHeight="100vh">
      <Flex direction="column" gap={6}>
        <Flex justifyContent="space-between" alignItems="center">
          <Typography variant="alpha">Activity Logs</Typography>
          <Typography variant="omega" textColor="neutral500">
            {pagination.total > 0
              ? `${first}–${last} of ${pagination.total}`
              : 'No records'}
          </Typography>
        </Flex>

        {!activityLoggingEnabled && (
          <Alert variant="caution" title="Activity logging is disabled">
            Enable &quot;Activity Logging&quot; in the Security Policy tab to start recording requests.
          </Alert>
        )}

        {error && (
          <Alert variant="danger" title="Failed to load activity logs">
            {error.message}
          </Alert>
        )}

        <FilterBar filters={filters} onChange={handleFilterChange} onReset={handleReset} />

        <Box background="neutral0" borderRadius="4px" shadow="tableShadow">
          {loading ? (
            <Box padding={6} textAlign="center">
              <Typography variant="omega" textColor="neutral500">Loading…</Typography>
            </Box>
          ) : (
            <ActivityTable logs={logs} activityLoggingEnabled={activityLoggingEnabled} />
          )}
        </Box>

        <Flex justifyContent="space-between" alignItems="center" wrap="wrap" gap={4}>
          <Flex gap={2} alignItems="center">
            <Typography variant="omega" textColor="neutral600">Rows per page</Typography>
            <Box width="88px">
              <SingleSelect
                aria-label="Rows per page"
                value={String(pageSize)}
                onChange={handlePageSize}
                size="S"
              >
                {PAGE_SIZES.map((n) => (
                  <SingleSelectOption key={n} value={String(n)}>{n}</SingleSelectOption>
                ))}
              </SingleSelect>
            </Box>
          </Flex>

          {pageCount > 1 && (
            <Pagination activePage={page} pageCount={pageCount}>
              <PreviousLink href="#" onClick={goTo(page - 1)}>Previous</PreviousLink>
              {buildPageList(page, pageCount).map((entry, i) =>
                entry === 'dots' ? (
                  // eslint-disable-next-line react/no-array-index-key
                  <Dots key={`dots-${i}`}>…</Dots>
                ) : (
                  <PageLink key={entry} number={entry} href="#" onClick={goTo(entry)}>
                    {entry}
                  </PageLink>
                )
              )}
              <NextLink href="#" onClick={goTo(page + 1)}>Next</NextLink>
            </Pagination>
          )}
        </Flex>
      </Flex>
    </Box>
  );
};

export default ActivityLogPage;
