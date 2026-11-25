import { useState, useEffect } from 'react';
import {
  Box, Typography, Alert, Link, Loader,
} from '@strapi/design-system';
import { usePluginStatus } from '../../hooks/usePluginStatus.js';
import { useApiClient } from '../../api/client.js';
import StoreStatus from './StoreStatus.jsx';
import ConfigSection from './ConfigSection.jsx';
import StepUpSection from './StepUpSection.jsx';
import PolicySection from './PolicySection.jsx';
import CaptchaSection from './CaptchaSection.jsx';

const SettingsPage = () => {
  const { status, loading: statusLoading, error: statusError } = usePluginStatus();
  const [config, setConfig]           = useState(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState(null);
  const client = useApiClient();

  useEffect(() => {
    setConfigLoading(true);
    client.getConfig()
      .then(({ data }) => setConfig(data?.data || data || null))
      .catch(err => setConfigError(err))
      .finally(() => setConfigLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Box>
      {/* Read-only notice */}
      <Box marginBottom={4}>
        <Alert
          closeLabel=""
          title="Read-only"
          variant="default"
          action={
            <Link href="https://github.com/your-org/erp-session-manager#configuration" isExternal>
              Configuration Guide ↗
            </Link>
          }
        >
          Configuration is managed via <code>config/plugins.js</code> and cannot be changed through the UI.
        </Alert>
      </Box>

      {/* Store Status */}
      <Box background="neutral0" borderRadius="4px" padding={6} shadow="filterShadow" marginBottom={4}>
        <Typography variant="beta" as="h2" marginBottom={4}>Store Status</Typography>
        {statusLoading && <Loader>Loading…</Loader>}
        {statusError && (
          <Alert closeLabel="Close" title="Error" variant="danger" onClose={() => {}}>
            {statusError.message}
          </Alert>
        )}
        {!statusLoading && !statusError && <StoreStatus status={status} />}
      </Box>

      {/* Two-Factor Authentication */}
      <Box background="neutral0" borderRadius="4px" padding={6} shadow="filterShadow" marginBottom={4}>
        <StepUpSection />
      </Box>

      {/* Live Security Policy */}
      <Box background="neutral0" borderRadius="4px" padding={6} shadow="filterShadow" marginBottom={4}>
        <PolicySection />
      </Box>

      {/* CAPTCHA (VAPT #20) */}
      <Box background="neutral0" borderRadius="4px" padding={6} shadow="filterShadow" marginBottom={4}>
        <CaptchaSection />
      </Box>

      {/* Configuration */}
      <Box background="neutral0" borderRadius="4px" padding={6} shadow="filterShadow">
        <Typography variant="beta" as="h2" marginBottom={4}>Plugin Configuration</Typography>

        {configLoading && <Loader>Loading configuration…</Loader>}

        {configError && (
          <Alert closeLabel="Close" title="Error" variant="danger" onClose={() => {}}>
            Failed to load configuration: {configError.message}
          </Alert>
        )}

        {!configLoading && !configError && config && (
          <ConfigSection config={config} />
        )}
      </Box>
    </Box>
  );
};

export default SettingsPage;
