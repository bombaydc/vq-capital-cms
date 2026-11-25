/**
 * CaptchaSection — live CAPTCHA configuration editor (VAPT #20).
 *
 * Lets Super Admins enable/disable the self-hosted SVG image CAPTCHA and
 * adjust settings without restarting the server. Changes are persisted to
 * strapi.store via PUT /erp-session-manager/config/captcha.
 */

import { useState, useEffect } from 'react';
import {
  Box, Flex, Typography, Button, Alert, Loader,
} from '@strapi/design-system';
import { useApiClient } from '../../api/client.js';

// ---------------------------------------------------------------------------
// Toggle sub-component (reuses PolicySection style)
// ---------------------------------------------------------------------------
const ToggleRow = ({ label, description, value, onChange }) => (
  <Box
    paddingTop={3}
    paddingBottom={3}
    style={{ borderBottom: '1px solid #f0f0f3' }}
  >
    <Flex gap={4} alignItems="flex-start" style={{ flexWrap: 'wrap' }}>
      <Box style={{ flex: '1 1 260px', minWidth: '200px' }}>
        <Typography style={{ fontSize: '14px', fontWeight: 600, display: 'block', marginBottom: '2px' }}>
          {label}
        </Typography>
        <Typography textColor="neutral500" style={{ fontSize: '12px', lineHeight: '1.5' }}>
          {description}
        </Typography>
      </Box>
      <Box style={{ flex: '0 0 auto' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
          />
          <Typography style={{ fontSize: '13px' }}>{value ? 'Enabled' : 'Disabled'}</Typography>
        </label>
      </Box>
    </Flex>
  </Box>
);

// ---------------------------------------------------------------------------
// NumberRow sub-component
// ---------------------------------------------------------------------------
const NumberRow = ({ label, description, value, onChange, min, max, unit }) => (
  <Box
    paddingTop={3}
    paddingBottom={3}
    style={{ borderBottom: '1px solid #f0f0f3' }}
  >
    <Flex gap={4} alignItems="flex-start" style={{ flexWrap: 'wrap' }}>
      <Box style={{ flex: '1 1 260px', minWidth: '200px' }}>
        <Typography style={{ fontSize: '14px', fontWeight: 600, display: 'block', marginBottom: '2px' }}>
          {label}
        </Typography>
        <Typography textColor="neutral500" style={{ fontSize: '12px', lineHeight: '1.5' }}>
          {description}
        </Typography>
      </Box>
      <Box style={{ flex: '0 0 auto', minWidth: '180px' }}>
        <Flex gap={2} alignItems="center">
          <input
            type="number"
            min={min}
            max={max}
            value={value !== undefined && value !== null ? String(value) : ''}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{
              width: '100px', padding: '8px 12px', fontSize: '14px', fontWeight: 500,
              border: '1px solid #dcdce4', borderRadius: '4px', outline: 'none',
              color: '#32324d', background: '#fff',
            }}
          />
          <Typography textColor="neutral500" style={{ fontSize: '13px', whiteSpace: 'nowrap' }}>
            {unit}
          </Typography>
        </Flex>
        <Typography textColor="neutral400" style={{ fontSize: '11px', marginTop: '4px', display: 'block' }}>
          Range: {min}–{max}
        </Typography>
      </Box>
    </Flex>
  </Box>
);

// ---------------------------------------------------------------------------
// CaptchaSection
// ---------------------------------------------------------------------------
const CaptchaSection = () => {
  const [config, setConfig]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);
  const [success, setSuccess]   = useState(false);
  const client = useApiClient();

  // Fetch current config on mount
  useEffect(() => {
    setLoading(true);
    client.getCaptchaConfig()
      .then(({ data }) => setConfig(data?.data ?? data ?? { enabled: false, enforceForContentApi: true, enforceForAdminPanel: true, ttlSeconds: 300 }))
      .catch((err) => setError(err?.message || 'Failed to load CAPTCHA config'))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const { data } = await client.updateCaptchaConfig(config);
      setConfig(data?.data ?? data ?? config);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err?.message || 'Failed to save CAPTCHA config');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Typography variant="beta" as="h2" marginBottom={2}>
        CAPTCHA
      </Typography>
      <Typography textColor="neutral500" style={{ fontSize: '13px', display: 'block', marginBottom: '16px' }}>
        Self-hosted SVG image CAPTCHA protects login, registration, and forgot-password
        from automated bots. No external service or API keys required.
        Changes take effect immediately — no server restart needed.
      </Typography>

      {loading && <Loader>Loading CAPTCHA config…</Loader>}

      {error && (
        <Alert closeLabel="Close" title="Error" variant="danger" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert closeLabel="Close" title="Saved" variant="success" onClose={() => setSuccess(false)}>
          CAPTCHA configuration updated successfully.
        </Alert>
      )}

      {!loading && config && (
        <>
          <Box
            background="neutral0"
            borderRadius="4px"
            padding={5}
            marginTop={4}
            style={{ border: '1px solid #dcdce4' }}
          >
            <Typography variant="delta" style={{ fontWeight: 600, display: 'block', marginBottom: '4px' }}>
              CAPTCHA Settings
            </Typography>
            <Typography textColor="neutral500" style={{ fontSize: '13px', marginBottom: '16px', display: 'block' }}>
              Configure when and how the image CAPTCHA challenge is enforced.
            </Typography>

            <ToggleRow
              label="Enable CAPTCHA"
              description="Master switch. When enabled, clients must obtain a challenge from GET /api/erp-session/captcha/challenge and submit captchaToken + captchaAnswer with every auth request."
              value={config.enabled}
              onChange={(v) => setConfig((c) => ({ ...c, enabled: v }))}
            />

            <ToggleRow
              label="Enforce for Admin Panel"
              description="Apply CAPTCHA to admin-panel auth pages: /admin/auth/login, /admin/auth/forgot-password, /admin/auth/reset-password, and /admin/auth/register-admin. The CAPTCHA widget is automatically injected into those pages."
              value={config.enforceForAdminPanel}
              onChange={(v) => setConfig((c) => ({ ...c, enforceForAdminPanel: v }))}
            />

            <ToggleRow
              label="Enforce for Content API"
              description="Apply CAPTCHA to content-API auth endpoints: POST /api/auth/local (login), /api/auth/local/register, and /api/auth/forgot-password. Disable only to restrict enforcement to admin login."
              value={config.enforceForContentApi}
              onChange={(v) => setConfig((c) => ({ ...c, enforceForContentApi: v }))}
            />

            <NumberRow
              label="Challenge TTL"
              description="How long a challengeToken remains valid after it is issued. After this window expires the user must request a new challenge."
              value={config.ttlSeconds}
              onChange={(v) => setConfig((c) => ({ ...c, ttlSeconds: v }))}
              min={60}
              max={3600}
              unit="seconds"
            />
          </Box>

          {/* Integration guide — shown when CAPTCHA is enabled */}
          {config.enabled && (
            <Box
              background="neutral100"
              borderRadius="4px"
              padding={5}
              marginTop={4}
              style={{ border: '1px solid #dcdce4' }}
            >
              <Typography variant="delta" style={{ fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                Frontend Integration
              </Typography>
              <Typography textColor="neutral500" style={{ fontSize: '12px', lineHeight: '1.8', display: 'block' }}>
                <strong>Step 1</strong> — Before showing the login / register form, call:
                <br />
                <code style={{ background: '#fff', padding: '2px 6px', borderRadius: '3px', fontSize: '11px' }}>
                  GET /api/erp-session/captcha/challenge
                </code>
                &nbsp;→&nbsp;
                <code style={{ background: '#fff', padding: '2px 6px', borderRadius: '3px', fontSize: '11px' }}>
                  {'{ captchaImage: "<svg>…</svg>", challengeToken: "…" }'}
                </code>
                <br /><br />
                <strong>Step 2</strong> — Render <code>captchaImage</code> as inline SVG. Display an input field
                labelled &quot;Enter the characters shown&quot;.
                <br /><br />
                <strong>Step 3</strong> — Submit with the auth request body:
                <br />
                <code style={{ background: '#fff', padding: '2px 6px', borderRadius: '3px', fontSize: '11px' }}>
                  {'{ ..., captchaToken: "…", captchaAnswer: "abc12" }'}
                </code>
                <br /><br />
                If the answer is wrong or the token has expired, the server returns{' '}
                <code style={{ background: '#fff', padding: '2px 6px', borderRadius: '3px', fontSize: '11px' }}>
                  HTTP 400 CAPTCHA verification failed
                </code>
                . Refresh the challenge and let the user try again.
              </Typography>
            </Box>
          )}

          <Box marginTop={4}>
            <Button
              variant="default"
              onClick={handleSave}
              loading={saving}
              disabled={saving}
            >
              Save CAPTCHA Settings
            </Button>
          </Box>
        </>
      )}
    </Box>
  );
};

export default CaptchaSection;
