/**
 * useActivityLogs — data-fetching hook for the Activity Log admin page (G19).
 */

import { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '../api/client.js';

/**
 * @param {object} [params] - query parameters (sessionId, userId, method, page, pageSize)
 * @returns {{ logs: object[], pagination: object, loading: boolean, error: Error|null, refetch: Function }}
 */
export function useActivityLogs(params = {}) {
  const [logs, setLogs]           = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, pageCount: 0 });
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  const client = useApiClient();

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await client.getActivityLogs(params);
      setLogs(data.data || []);
      setPagination(data.meta?.pagination || { page: 1, pageSize: 25, total: 0, pageCount: 0 });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(params)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  return { logs, pagination, loading, error, refetch: fetchLogs };
}
