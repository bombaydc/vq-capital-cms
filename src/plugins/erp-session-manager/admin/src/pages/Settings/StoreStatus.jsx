import { useState } from 'react';
import PropTypes from 'prop-types';
import { Box, Flex, Typography, Status, Button, Loader } from '@strapi/design-system';
import { useApiClient } from '../../api/client.js';

const BACKEND_MAP = {
  redis: { variant: 'success', label: 'Redis' },
  hybrid: { variant: 'success', label: 'Hybrid (Memory + MariaDB)' },
  database: { variant: 'success', label: 'Database (MariaDB)' },
};

function getBackendConfig(backend = 'memory') {
  return BACKEND_MAP[backend] || { variant: 'secondary', label: 'Memory (in-process)' };
}

const REDIS_STATUS_MAP = {
  connected: { variant: 'success', label: 'Connected' },
  fallback: { variant: 'warning', label: 'Fallback (memory)' },
};

function getRedisStatusConfig(status = 'disabled') {
  return REDIS_STATUS_MAP[status] || { variant: 'secondary', label: 'Disabled' };
}

function formatTestResult(testResult) {
  if (!testResult) return null;
  if (testResult.connected) {
    const hostInfo = testResult.host ? ` (${testResult.host}:${testResult.port || 6379})` : '';
    return `Connected — ${testResult.latencyMs}ms${hostInfo}`;
  }
  return testResult.error || testResult.message || 'Not connected';
}

const StoreStatus = ({ status }) => {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const client = useApiClient();

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await client.testRedis();
      setTestResult(data?.data || data || {});
    } catch (err) {
      setTestResult({ error: err?.message || 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  if (!status) {
    return (
      <Flex justifyContent="center" padding={4}>
        <Loader>Loading store status…</Loader>
      </Flex>
    );
  }

  const { variant: backendVariant, label: backendLabel } = getBackendConfig(status.storeBackend);
  const { variant: redisVariant, label: redisLabel } = getRedisStatusConfig(status.redisStatus);
  const testResultLabel = formatTestResult(testResult);

  return (
    <Box>
      <Flex gap={6} wrap="wrap" marginBottom={4}>
        <Box>
          <Typography variant="sigma" textColor="neutral500">Active Backend</Typography>
          <Box marginTop={2}>
            <Status variant={backendVariant} size="S">
              <span>{backendLabel}</span>
            </Status>
          </Box>
        </Box>

        <Box>
          <Typography variant="sigma" textColor="neutral500">Redis Status</Typography>
          <Box marginTop={2}>
            <Status variant={redisVariant} size="S">
              <span>{redisLabel}</span>
            </Status>
          </Box>
        </Box>

        {status.activeSessions !== undefined && (
          <Box>
            <Typography variant="sigma" textColor="neutral500">Active Sessions</Typography>
            <Typography variant="beta" textColor="neutral800" marginTop={2}>
              {status.activeSessions}
            </Typography>
          </Box>
        )}
      </Flex>

      <Flex gap={3} alignItems="center" marginTop={2}>
        <Button
          variant="secondary"
          onClick={handleTest}
          loading={testing}
          disabled={testing}
          size="S"
        >
          Test Redis Connection
        </Button>

        {testResultLabel && !testing && (
          <Status variant={testResult?.connected ? 'success' : 'danger'} size="S">
            <span>{testResultLabel}</span>
          </Status>
        )}
      </Flex>
    </Box>
  );
};

StoreStatus.propTypes = {
  status: PropTypes.shape({
    storeBackend: PropTypes.string,
    redisStatus: PropTypes.string,
  }),
};

export default StoreStatus;
