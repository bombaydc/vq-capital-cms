import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Flex, Typography, Alert } from '@strapi/design-system';
import { useSessions } from '../../hooks/useSessions.js';
import { useApiClient } from '../../api/client.js';
import SummaryCards from './SummaryCards.jsx';
import FilterBar from './FilterBar.jsx';
import SessionTable from './SessionTable.jsx';
import SessionDetailModal from './SessionDetailModal.jsx';

const AUTO_REFRESH_MS = 30_000;

const SessionsPage = () => {
  const [filters, setFilters]           = useState({});
  const [page, setPage]                 = useState(1);
  const [pageSize, setPageSize]         = useState(25);
  const [selectedSession, setSelected]  = useState(null);
  const [isModalOpen, setModalOpen]     = useState(false);
  const [revokedIds, setRevokedIds]     = useState(new Set());
  const [notification, setNotification] = useState(null);
  const [showRevoked, setShowRevoked]   = useState(false);
  const timerRef = useRef(null);
  const client   = useApiClient();

  const queryParams = {
    page, pageSize,
    ...(filters.email  ? { email: filters.email }   : {}),
    ...(filters.ip     ? { ip: filters.ip }          : {}),
    ...(filters.status && filters.status !== 'all' ? { status: filters.status } : {}),
    ...(filters.from   ? { from: filters.from }      : {}),
    ...(filters.to     ? { to: filters.to }          : {}),
  };

  const { sessions: allSessions, pagination, loading, error, refetch } = useSessions(queryParams);

  // Filter out revoked sessions unless the user explicitly wants to see them
  const sessions = showRevoked
    ? allSessions
    : allSessions.filter(s => !s.isRevoked && !revokedIds.has(s.sessionId));

  const now = Date.now();
  const activeSessions   = allSessions.filter(s => !s.isRevoked && !s.anomalyFlags?.length).length;
  const anomalySessions  = allSessions.filter(s => s.anomalyFlags?.length > 0).length;
  const expiringSessions = allSessions.filter(s => !s.isRevoked && s.expiresAt && s.expiresAt - now < 30 * 60 * 1000).length;

  const notify = (message, variant = 'success') => {
    setNotification({ message, variant });
    setTimeout(() => setNotification(null), 4000);
  };

  const handleAutoRefresh = useCallback((enabled) => {
    clearInterval(timerRef.current);
    if (enabled) timerRef.current = setInterval(refetch, AUTO_REFRESH_MS);
  }, [refetch]);

  useEffect(() => () => clearInterval(timerRef.current), []);

  const handleRevoke = useCallback(async (sessionId) => {
    setRevokedIds(prev => new Set([...prev, sessionId]));
    try {
      await client.revokeSession(sessionId);
      notify(`Session ${sessionId.slice(0, 8)}… revoked successfully.`);
      refetch();
    } catch (err) {
      setRevokedIds(prev => { const n = new Set(prev); n.delete(sessionId); return n; });
      notify(err?.message || 'Failed to revoke session.', 'danger');
    }
  }, [client, refetch]);

  const handleRevokeAllForUser = useCallback(async (userId) => {
    const ids = allSessions.filter(s => s.userId === userId).map(s => s.sessionId);
    setRevokedIds(prev => new Set([...prev, ...ids]));
    try {
      await client.revokeSessionsByUser(userId);
      notify(`All sessions for user #${userId} revoked.`);
      refetch();
    } catch (err) {
      setRevokedIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
      notify(err?.message || 'Failed to revoke sessions.', 'danger');
    }
  }, [client, refetch, allSessions]);

  const handleRevokeSelected = useCallback(async (sessionIds) => {
    setRevokedIds(prev => new Set([...prev, ...sessionIds]));
    try {
      await client.revokeSessionsBulk(sessionIds);
      notify(`${sessionIds.length} session(s) revoked.`);
      refetch();
    } catch (err) {
      setRevokedIds(prev => { const n = new Set(prev); sessionIds.forEach(id => n.delete(id)); return n; });
      notify(err?.message || 'Bulk revoke failed.', 'danger');
    }
  }, [client, refetch]);

  return (
    <Box>
      {notification && (
        <Box marginBottom={4}>
          <Alert
            closeLabel="Close"
            title={notification.variant === 'danger' ? 'Error' : 'Success'}
            variant={notification.variant}
            onClose={() => setNotification(null)}
          >
            {notification.message}
          </Alert>
        </Box>
      )}

      <SummaryCards
        activeSessions={activeSessions}
        anomalySessions={anomalySessions}
        expiringSessions={expiringSessions}
      />

      <FilterBar
        onFilterChange={(f) => { setFilters(f); setPage(1); }}
        onAutoRefreshChange={handleAutoRefresh}
      />

      {/* Show/hide revoked sessions toggle */}
      <Box paddingBottom={3}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.875rem', color: '#666687' }}>
          <input
            type="checkbox"
            checked={showRevoked}
            onChange={e => setShowRevoked(e.target.checked)}
            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
          />
          Show revoked sessions
        </label>
      </Box>

      {error && (
        <Box marginBottom={4}>
          <Alert closeLabel="Close" title="Error" variant="danger" onClose={() => {}}>
            Failed to load sessions: {error.message}
          </Alert>
        </Box>
      )}

      {loading && (
        <Box paddingTop={2} paddingBottom={2}>
          <Typography variant="omega" textColor="neutral500">Loading sessions…</Typography>
        </Box>
      )}

      <SessionTable
        sessions={sessions}
        pagination={pagination}
        onRevoke={handleRevoke}
        onViewDetails={(s) => { setSelected(s); setModalOpen(true); }}
        onRevokeSelected={handleRevokeSelected}
        onRevokeAllForUser={handleRevokeAllForUser}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        revokedIds={revokedIds}
      />

      <SessionDetailModal
        session={selectedSession}
        isOpen={isModalOpen}
        onClose={() => { setModalOpen(false); setSelected(null); }}
        onRevoke={handleRevoke}
      />
    </Box>
  );
};

export default SessionsPage;
