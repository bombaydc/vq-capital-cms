/**
 * RedisTestButton — triggers a live Redis connectivity test and shows the result inline.
 *
 * Req 7C.5: "Test Redis Connection" button with inline latency/error result.
 */

import { useState } from 'react';
import { useApiClient } from '../../api/client.js';

const RedisTestButton = () => {
  const [status, setStatus] = useState(null); // null | 'loading' | 'success' | 'error'
  const [result, setResult] = useState(null);
  const client = useApiClient();

  const handleTest = async () => {
    setStatus('loading');
    setResult(null);
    try {
      const { data } = await client.testRedis();
      const payload = data?.data || data || {};
      setResult(payload);
      setStatus(payload.connected ? 'success' : 'error');
    } catch (err) {
      setResult({ error: err?.message || 'Connection failed' });
      setStatus('error');
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={handleTest}
        disabled={status === 'loading'}
        style={{
          padding: '0.4rem 0.9rem',
          border: '1px solid #ccc',
          borderRadius: '4px',
          background: status === 'loading' ? '#f5f5f5' : '#fff',
          cursor: status === 'loading' ? 'not-allowed' : 'pointer',
          fontSize: '0.875rem',
          fontWeight: '500',
        }}
        aria-label="Test Redis connection"
        aria-busy={status === 'loading'}
      >
        🔌 Test Redis Connection
      </button>

      {status === 'loading' && (
        <span style={{ fontSize: '0.875rem', color: '#666' }} aria-live="polite">
          Testing…
        </span>
      )}

      {status === 'success' && result && (
        <span
          style={{ fontSize: '0.875rem', color: '#2e7d32', fontWeight: '500' }}
          role="status"
          aria-live="polite"
        >
          ✅ Connected
          {result.latencyMs !== undefined ? ` (${result.latencyMs}ms)` : ''}
          {result.host ? ` — ${result.host}:${result.port || 6379}` : ''}
        </span>
      )}

      {status === 'error' && result && (
        <span
          style={{ fontSize: '0.875rem', color: '#c62828', fontWeight: '500' }}
          role="alert"
          aria-live="polite"
        >
          ❌ {result.error || 'Connection failed'}
        </span>
      )}
    </div>
  );
};

export default RedisTestButton;
