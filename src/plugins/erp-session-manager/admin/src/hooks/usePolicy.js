/**
 * usePolicy — data-fetching and save hook for the Security Policy admin tab (G20).
 */

import { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '../api/client.js';

/**
 * @returns {{ policy: object|null, loading: boolean, error: Error|null, saving: boolean, saveError: Error|null, refetch: Function, savePolicy: Function }}
 */
export function usePolicy() {
  const [policy, setPolicy]       = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState(null);

  const client = useApiClient();

  const fetchPolicy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await client.getPolicy();
      setPolicy(data.data || data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchPolicy(); }, [fetchPolicy]);

  /**
   * Save policy fields, optionally with a step-up token.
   * Returns { success: boolean, error: Error|null, stepUpRequired: boolean }.
   */
  const savePolicy = useCallback(async (fields, stepUpToken) => {
    setSaving(true);
    setSaveError(null);
    try {
      const { data } = await client.updatePolicy(fields, stepUpToken);
      setPolicy(data.data || data);
      return { success: true, error: null, stepUpRequired: false };
    } catch (err) {
      const status = err?.response?.status || err?.status;
      const stepUpRequired = status === 403 &&
        (err?.response?.data?.error?.details?.stepUpRequired ||
         err?.response?.data?.stepUpRequired);
      setSaveError(err);
      return { success: false, error: err, stepUpRequired: Boolean(stepUpRequired) };
    } finally {
      setSaving(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { policy, loading, error, saving, saveError, refetch: fetchPolicy, savePolicy };
}
