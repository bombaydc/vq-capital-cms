/**
 * useSessions — data-fetching hook for the Sessions admin page.
 *
 * Fetches the paginated session list from the plugin API and exposes
 * loading, error, and refetch state.
 *
 * Design §3 (admin/src/hooks/useSessions.js)
 */

import { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '../api/client.js';

/**
 * @param {object} [params] - query parameters (page, pageSize, userId, ip, status, etc.)
 * @returns {{ sessions: object[], pagination: object, loading: boolean, error: Error|null, refetch: Function }}
 */
export function useSessions(params = {}) {
  const [sessions, setSessions] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, pageCount: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const client = useApiClient();

  // Stringify params so useCallback dependency comparison works correctly
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await client.getSessions(params);
      setSessions(data.data || []);
      setPagination(data.meta?.pagination || { page: 1, pageSize: 25, total: 0, pageCount: 0 });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(params)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  return { sessions, pagination, loading, error, refetch: fetchSessions };
}
