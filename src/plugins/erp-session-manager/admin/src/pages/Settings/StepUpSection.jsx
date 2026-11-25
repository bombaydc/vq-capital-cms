import { useState, useEffect, useCallback } from 'react';
import { Box, Flex, Typography, Alert, Loader } from '@strapi/design-system';
import { useApiClient } from '../../api/client.js';

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------

const Badge = ({ children, color }) => (
  <span style={{
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 600,
    background: color === 'green' ? '#d1fae5' : color === 'red' ? '#fee2e2' : '#fef3c7',
    color:      color === 'green' ? '#065f46' : color === 'red' ? '#991b1b' : '#92400e',
  }}>
    {children}
  </span>
);

const Btn = ({ children, onClick, disabled, variant = 'primary', small }) => {
  const styles = {
    primary:   { background: '#4945ff', color: '#fff', border: 'none' },
    secondary: { background: 'transparent', color: '#4945ff', border: '1px solid #4945ff' },
    danger:    { background: 'transparent', color: '#d02b20', border: '1px solid #d02b20' },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...styles[variant],
        padding: small ? '6px 14px' : '10px 20px',
        borderRadius: '6px',
        fontSize: small ? '13px' : '14px',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      {children}
    </button>
  );
};

// Numeric-only 6-digit TOTP input
const TotpInput = ({ value, onChange, onEnter, disabled }) => (
  <input
    type="text"
    inputMode="numeric"
    autoComplete="one-time-code"
    maxLength={6}
    value={value}
    disabled={disabled}
    placeholder="000000"
    onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
    onKeyDown={e => e.key === 'Enter' && onEnter && onEnter()}
    style={{
      width: '140px',
      padding: '10px 0',
      fontSize: '24px',
      fontWeight: 700,
      letterSpacing: '10px',
      textAlign: 'center',
      border: '2px solid #dcdce4',
      borderRadius: '8px',
      outline: 'none',
      color: '#32324d',
    }}
  />
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const StepUpSection = () => {
  const client = useApiClient();

  const [loading, setLoading]           = useState(true);
  const [globalEnabled, setGlobalEnabled] = useState(null);
  const [userStatus, setUserStatus]     = useState(null);   // { provisioned, lastUsedAt }
  const [notification, setNotification] = useState(null);

  // Setup flow: 'idle' | 'scanning' | 'verifying_setup' | 'removing' | 'regenerating'
  const [phase, setPhase]               = useState('idle');
  const [setupData, setSetupData]       = useState(null);   // { provisioningUri, base32Secret, qrCodeDataUri }
  const [code, setCode]                 = useState('');
  const [codeError, setCodeError]       = useState(null);
  const [working, setWorking]           = useState(false);

  const notify = (message, variant = 'success') => {
    setNotification({ message, variant });
    setTimeout(() => setNotification(null), 5000);
  };

  // Initial data load
  useEffect(() => {
    Promise.all([
      client.getStepUpGlobalConfig().catch(() => null),
      client.getStepUpStatus().catch(() => null),
    ]).then(([cfgRes, statusRes]) => {
      setGlobalEnabled(cfgRes?.data?.data?.enabled ?? true);
      setUserStatus(statusRes?.data?.data ?? { provisioned: false, lastUsedAt: null });
    }).finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toggle global enable/disable ──────────────────────────────────────────
  const handleToggleEnabled = useCallback(async () => {
    const newVal = !globalEnabled;
    try {
      await client.setStepUpEnabled(newVal);
      setGlobalEnabled(newVal);
      notify(`Two-factor authentication ${newVal ? 'enabled' : 'disabled'} globally.`);
    } catch (err) {
      notify('Failed to update setting: ' + (err?.message || 'unknown error'), 'danger');
    }
  }, [client, globalEnabled]);

  // ── Start TOTP setup ─────────────────────────────────────────────────────
  const handleStartSetup = useCallback(async () => {
    setWorking(true);
    try {
      const res = await client.getStepUpSetup();
      setSetupData(res?.data?.data);
      setPhase('scanning');
      setCode('');
      setCodeError(null);
    } catch (err) {
      notify('Failed to start TOTP setup: ' + (err?.message || 'unknown error'), 'danger');
    } finally {
      setWorking(false);
    }
  }, [client]);

  // ── Verify setup code ────────────────────────────────────────────────────
  const handleVerifySetup = useCallback(async () => {
    if (code.length !== 6) { setCodeError('Enter all 6 digits.'); return; }
    setWorking(true);
    setCodeError(null);
    try {
      await client.verifyStepUpSetup(code);
      setUserStatus({ provisioned: true, lastUsedAt: null });
      setPhase('idle');
      setSetupData(null);
      setCode('');
      notify('TOTP configured! You will be prompted for a code on your next login.');
    } catch {
      setCodeError('Invalid code. Please try again.');
    } finally {
      setWorking(false);
    }
  }, [client, code]);

  // ── Remove secret ────────────────────────────────────────────────────────
  const handleRemove = useCallback(async () => {
    setWorking(true);
    try {
      await client.removeStepUpSecret();
      setUserStatus({ provisioned: false, lastUsedAt: null });
      setPhase('idle');
      setCode('');
      notify('TOTP removed. You will no longer be prompted for a code on login.');
    } catch (err) {
      notify('Failed to remove TOTP: ' + (err?.message || 'unknown error'), 'danger');
    } finally {
      setWorking(false);
    }
  }, [client]);

  // ── Regenerate — step 1: verify current code ─────────────────────────────
  const handleRegenerateVerify = useCallback(async () => {
    if (code.length !== 6) { setCodeError('Enter all 6 digits.'); return; }
    setWorking(true);
    setCodeError(null);
    try {
      const res = await client.regenerateStepUp(code);
      setSetupData(res?.data?.data);
      setPhase('scanning');
      setCode('');
      setCodeError(null);
    } catch {
      setCodeError('Invalid code. Cannot regenerate secret.');
    } finally {
      setWorking(false);
    }
  }, [client, code]);

  const cancelFlow = () => {
    setPhase('idle');
    setSetupData(null);
    setCode('');
    setCodeError(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Box>
        <Typography variant="beta" as="h2" marginBottom={4}>
          Two-Factor Authentication (TOTP)
        </Typography>
        <Loader>Loading…</Loader>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="beta" as="h2" marginBottom={2}>
        Two-Factor Authentication (TOTP)
      </Typography>
      <Typography textColor="neutral500" marginBottom={6} style={{ fontSize: '14px' }}>
        When enabled, super admins with a configured authenticator app must enter a 6-digit code after every login.
      </Typography>

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

      {/* ── Global enable/disable toggle ── */}
      <Box
        background="neutral50"
        borderRadius="4px"
        padding={4}
        marginBottom={6}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}
      >
        <Box>
          <Typography variant="delta" style={{ fontWeight: 600 }}>
            Require TOTP on login
          </Typography>
          <Typography textColor="neutral500" style={{ fontSize: '13px', marginTop: '4px' }}>
            Affects all super admins who have configured an authenticator app.
          </Typography>
        </Box>
        <Flex gap={3} alignItems="center">
          <Badge color={globalEnabled ? 'green' : 'amber'}>
            {globalEnabled ? 'Enabled' : 'Disabled'}
          </Badge>
          <Btn
            variant={globalEnabled ? 'danger' : 'secondary'}
            small
            onClick={handleToggleEnabled}
          >
            {globalEnabled ? 'Disable' : 'Enable'}
          </Btn>
        </Flex>
      </Box>

      {/* ── Current user TOTP status ── */}
      <Box
        background="neutral0"
        borderRadius="4px"
        padding={5}
        style={{ border: '1px solid #dcdce4' }}
      >
        <Typography variant="delta" style={{ fontWeight: 600, marginBottom: '16px', display: 'block' }}>
          Your Authenticator App
        </Typography>

        {/* ── IDLE state ── */}
        {phase === 'idle' && (
          <Flex alignItems="center" gap={4} style={{ flexWrap: 'wrap' }}>
            {userStatus?.provisioned ? (
              <>
                <Badge color="green">Configured</Badge>
                {userStatus.lastUsedAt && (
                  <Typography textColor="neutral500" style={{ fontSize: '13px' }}>
                    Last used: {new Date(userStatus.lastUsedAt).toLocaleString()}
                  </Typography>
                )}
                <Box style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                  <Btn
                    variant="secondary"
                    small
                    disabled={working}
                    onClick={() => { setPhase('regenerating'); setCode(''); setCodeError(null); }}
                  >
                    Regenerate secret
                  </Btn>
                  <Btn
                    variant="danger"
                    small
                    disabled={working}
                    onClick={() => { setPhase('removing'); }}
                  >
                    Remove
                  </Btn>
                </Box>
              </>
            ) : (
              <>
                <Badge color="amber">Not configured</Badge>
                <Typography textColor="neutral500" style={{ fontSize: '13px' }}>
                  Set up an authenticator app to enable TOTP login protection for your account.
                </Typography>
                <Btn small disabled={working} onClick={handleStartSetup}>
                  {working ? 'Loading…' : 'Set up TOTP'}
                </Btn>
              </>
            )}
          </Flex>
        )}

        {/* ── SCANNING state — show QR + manual secret ── */}
        {phase === 'scanning' && setupData && (
          <Box>
            <Typography style={{ fontSize: '14px', marginBottom: '16px' }}>
              Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.).
            </Typography>

            <Flex gap={8} alignItems="flex-start" style={{ flexWrap: 'wrap', marginBottom: '24px' }}>
              {/* QR code */}
              {setupData.qrCodeDataUri ? (
                <Box style={{ border: '8px solid #fff', boxShadow: '0 0 0 1px #dcdce4', borderRadius: '4px', lineHeight: 0 }}>
                  <img
                    src={setupData.qrCodeDataUri}
                    alt="TOTP QR Code"
                    style={{ width: '200px', height: '200px', display: 'block' }}
                  />
                </Box>
              ) : (
                <Box style={{ width: '200px', height: '200px', border: '2px dashed #dcdce4', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography textColor="neutral500" style={{ fontSize: '12px', textAlign: 'center', padding: '8px' }}>
                    QR unavailable — enter key manually
                  </Typography>
                </Box>
              )}

              {/* Manual entry */}
              <Box>
                <Typography style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                  Can't scan? Enter this key manually:
                </Typography>
                <Box
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '16px',
                    letterSpacing: '2px',
                    fontWeight: 700,
                    padding: '12px 16px',
                    background: '#f6f6f9',
                    borderRadius: '6px',
                    border: '1px solid #dcdce4',
                    wordBreak: 'break-all',
                    maxWidth: '260px',
                  }}
                >
                  {setupData.base32Secret}
                </Box>
                <Typography textColor="neutral400" style={{ fontSize: '12px', marginTop: '8px' }}>
                  Type: Time-based (TOTP) · Period: 30s · Digits: 6
                </Typography>
              </Box>
            </Flex>

            {/* Verify step */}
            <Box style={{ borderTop: '1px solid #dcdce4', paddingTop: '20px' }}>
              <Typography style={{ fontSize: '14px', marginBottom: '12px', fontWeight: 600 }}>
                Enter the 6-digit code from your app to confirm:
              </Typography>
              <Flex gap={3} alignItems="center" style={{ flexWrap: 'wrap' }}>
                <TotpInput
                  value={code}
                  onChange={setCode}
                  onEnter={handleVerifySetup}
                  disabled={working}
                />
                <Btn onClick={handleVerifySetup} disabled={working || code.length !== 6}>
                  {working ? 'Verifying…' : 'Verify and save'}
                </Btn>
                <Btn variant="secondary" onClick={cancelFlow} disabled={working}>
                  Cancel
                </Btn>
              </Flex>
              {codeError && (
                <Typography style={{ color: '#d02b20', fontSize: '13px', marginTop: '8px' }}>
                  {codeError}
                </Typography>
              )}
            </Box>
          </Box>
        )}

        {/* ── REMOVING state ── */}
        {phase === 'removing' && (
          <Box>
            <Alert closeLabel="" title="Confirm removal" variant="danger" onClose={() => {}}>
              Removing your TOTP secret means you will no longer be prompted for a code on login.
              You can set it up again at any time.
            </Alert>
            <Flex gap={3} style={{ marginTop: '16px' }}>
              <Btn variant="danger" disabled={working} onClick={handleRemove}>
                {working ? 'Removing…' : 'Yes, remove TOTP'}
              </Btn>
              <Btn variant="secondary" onClick={cancelFlow} disabled={working}>
                Cancel
              </Btn>
            </Flex>
          </Box>
        )}

        {/* ── REGENERATING state — verify current code first ── */}
        {phase === 'regenerating' && (
          <Box>
            <Typography style={{ fontSize: '14px', marginBottom: '12px' }}>
              Enter your <strong>current</strong> authenticator code to regenerate a new secret:
            </Typography>
            <Flex gap={3} alignItems="center" style={{ flexWrap: 'wrap' }}>
              <TotpInput
                value={code}
                onChange={setCode}
                onEnter={handleRegenerateVerify}
                disabled={working}
              />
              <Btn onClick={handleRegenerateVerify} disabled={working || code.length !== 6}>
                {working ? 'Verifying…' : 'Verify and regenerate'}
              </Btn>
              <Btn variant="secondary" onClick={cancelFlow} disabled={working}>
                Cancel
              </Btn>
            </Flex>
            {codeError && (
              <Typography style={{ color: '#d02b20', fontSize: '13px', marginTop: '8px' }}>
                {codeError}
              </Typography>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default StepUpSection;
