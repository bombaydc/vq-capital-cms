/**
 * usePluginStatus -- data-fetching hook for the Settings admin page.
 *
 * Fetches the live plugin status (store backend, Redis connectivity,
 * active session counts) from the /erp-session-manager/status endpoint.
 *
 * Design §3 (admin/src/hooks/usePluginStatus.js)
 */

import { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '../api/client.js';

/**
 * @returns {{ status: object|null, loading: boolean, error: Error|null, refetch: Function }}
 */
export function usePluginStatus() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const client = useApiClient();

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await client.getStatus();
      setStatus(data.data || null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return { status, loading, error, refetch: fetchStatus };
}
