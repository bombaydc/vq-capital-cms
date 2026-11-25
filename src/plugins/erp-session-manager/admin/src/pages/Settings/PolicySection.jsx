/**
 * PolicySection — live security policy editor (G20/G21).
 *
 * Redesigned with:
 *  - Grouped sections (Sessions, Tokens, Alerts, Logging)
 *  - Inline unit labels and descriptions per field
 *  - Validation feedback before save
 *  - Step-up TOTP gate on save
 */

import { useState, useEffect } from 'react';
import {
  Box, Flex, Typography, Button, Alert, Loader,
} from '@strapi/design-system';
import { usePolicy } from '../../hooks/usePolicy.js';
import StepUpModal from '../../components/StepUpModal.jsx';

// ---------------------------------------------------------------------------
// Field definitions — grouped with descriptions and unit labels
// ---------------------------------------------------------------------------

const GROUPS = [
  {
    title: 'Session Limits',
    description: 'Control how long sessions stay active and how many can run simultaneously.',
    fields: [
      {
        key:   'maxConcurrentSessions',
        label: 'Max Concurrent Sessions',
        type:  'number',
        unit:  'sessions',
        min:   1,
        max:   20,
        placeholder: '3',
        description: 'Maximum number of active sessions allowed per user at the same time. Oldest sessions are evicted when the limit is reached.',
      },
      {
        key:   'idleTimeoutMinutes',
        label: 'Idle Timeout',
        type:  'number',
        unit:  'minutes',
        min:   1,
        max:   1440,
        placeholder: '30',
        description: 'Sessions inactive for longer than this are automatically expired.',
      },
      {
        key:   'absoluteTimeoutHours',
        label: 'Absolute Timeout',
        type:  'number',
        unit:  'hours',
        min:   1,
        max:   168,
        placeholder: '8',
        description: 'Hard maximum session lifetime regardless of activity. Users must re-authenticate after this period.',
      },
      {
        key:   'sessionRetentionDays',
        label: 'Session Record Retention',
        type:  'number',
        unit:  'days',
        min:   1,
        max:   365,
        placeholder: '90',
        description: 'How long revoked and expired session records are kept in the database before being purged.',
      },
    ],
  },
  {
    title: 'Token Settings',
    description: 'Configure token rotation and step-up authentication validity windows.',
    fields: [
      {
        key:   'tokenRotationMinutes',
        label: 'Token Rotation Interval',
        type:  'number',
        unit:  'minutes',
        min:   1,
        max:   30,
        placeholder: '15',
        description: 'How often admin access tokens are silently rotated (their lifespan before the panel renews them). Capped at 30 minutes per OWASP ASVS 3.7 (VAPT #7).',
      },
      {
        key:   'stepUpValidityMinutes',
        label: 'Step-Up Token Validity',
        type:  'number',
        unit:  'minutes',
        min:   1,
        max:   60,
        placeholder: '10',
        description: 'How long a step-up TOTP token remains valid after verification before the user must re-authenticate for sensitive actions.',
      },
    ],
  },
  {
    title: 'Alerts & Monitoring',
    description: 'Set thresholds for security alerts and define business hours for anomaly detection.',
    fields: [
      {
        key:   'alertAfterFailedAttempts',
        label: 'Alert After Failed Login Attempts',
        type:  'number',
        unit:  'attempts',
        min:   1,
        max:   20,
        placeholder: '5',
        description: 'Number of consecutive failed login attempts before an alert is triggered for that account.',
      },
      {
        key:   'businessHoursStart',
        label: 'Business Hours Start',
        type:  'number',
        unit:  'hour (0–23)',
        min:   0,
        max:   23,
        placeholder: '9',
        description: 'Start of the business hours window used for off-hours anomaly detection (24-hour format).',
      },
      {
        key:   'businessHoursEnd',
        label: 'Business Hours End',
        type:  'number',
        unit:  'hour (0–23)',
        min:   0,
        max:   23,
        placeholder: '18',
        description: 'End of the business hours window used for off-hours anomaly detection (24-hour format).',
      },
    ],
    boolFields: [
      {
        key:   'alertNewDevice',
        label: 'Alert on New Device Login',
        description: 'Send an alert when a user logs in from a device or browser that has not been seen before.',
      },
      {
        key:   'alertAnomaly',
        label: 'Alert on Session Anomaly',
        description: 'Send an alert when a session anomaly is detected (e.g. impossible travel, IP change).',
      },
    ],
  },
  {
    title: 'Activity Logging',
    description: 'Control what gets logged and how long logs are retained.',
    fields: [
      {
        key:   'activityLogRetentionDays',
        label: 'Activity Log Retention',
        type:  'number',
        unit:  'days',
        min:   1,
        max:   365,
        placeholder: '90',
        description: 'How long session activity log entries are kept before automatic cleanup.',
      },
    ],
    boolFields: [
      {
        key:   'activityLoggingEnabled',
        label: 'Enable Activity Logging',
        description: 'Record detailed per-session activity events (page views, API calls). Disabling reduces storage usage but limits audit capability.',
      },
    ],
  },
  {
    title: 'Anomaly Detection',
    description: 'Control how mid-session anomalies are detected and whether they block the session.',
    fields: [
      {
        key:   'maxSpeedKmh',
        label: 'Max Travel Speed',
        type:  'number',
        unit:  'km/h',
        min:   1,
        max:   99999,
        placeholder: '900',
        description: 'Maximum plausible travel speed between two session locations. Sessions exceeding this speed trigger an impossible-travel block (when impossible travel is enabled).',
      },
    ],
    boolFields: [
      {
        key:   'blockOnIpChange',
        label: 'Block on IP Change',
        description: 'Immediately revoke a session when the client IP address changes mid-session. Disable for users on mobile networks or VPNs.',
      },
      {
        key:   'blockOnUaChange',
        label: 'Block on User-Agent Change',
        description: 'Immediately revoke a session when the browser User-Agent string changes mid-session.',
      },
      {
        key:   'impossibleTravelEnabled',
        label: 'Enable Impossible Travel Detection',
        description: 'Block sessions where the geographic distance between two requests implies a travel speed exceeding the configured maximum. Requires GeoLite2 database.',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const SectionCard = ({ title, description, children }) => (
  <Box
    background="neutral0"
    borderRadius="4px"
    padding={5}
    marginBottom={4}
    style={{ border: '1px solid #dcdce4' }}
  >
    <Typography
      variant="delta"
      style={{ fontWeight: 600, display: 'block', marginBottom: '4px' }}
    >
      {title}
    </Typography>
    <Typography
      textColor="neutral500"
      style={{ fontSize: '13px', marginBottom: '20px', display: 'block' }}
    >
      {description}
    </Typography>
    {children}
  </Box>
);

const FieldRow = ({ field, value, onChange, error: fieldError }) => {
  const hasError = Boolean(fieldError);
  return (
    <Box
      paddingTop={3}
      paddingBottom={3}
      style={{ borderBottom: '1px solid #f0f0f3' }}
    >
      <Flex gap={4} alignItems="flex-start" style={{ flexWrap: 'wrap' }}>
        {/* Label + description column */}
        <Box style={{ flex: '1 1 260px', minWidth: '200px' }}>
          <Typography
            style={{ fontSize: '14px', fontWeight: 600, display: 'block', marginBottom: '2px' }}
          >
            {field.label}
          </Typography>
          <Typography
            textColor="neutral500"
            style={{ fontSize: '12px', lineHeight: '1.5' }}
          >
            {field.description}
          </Typography>
        </Box>

        {/* Input column */}
        <Box style={{ flex: '0 0 auto', minWidth: '180px' }}>
          <Flex gap={2} alignItems="center">
            <input
              type="number"
              min={field.min}
              max={field.max}
              placeholder={field.placeholder}
              value={value !== undefined && value !== null ? String(value) : ''}
              onChange={(e) => onChange(field.key, e.target.value)}
              style={{
                width: '100px',
                padding: '8px 12px',
                fontSize: '14px',
                fontWeight: 500,
                border: `1px solid ${hasError ? '#d02b20' : '#dcdce4'}`,
                borderRadius: '4px',
                outline: 'none',
                color: '#32324d',
                background: '#fff',
              }}
            />
            <Typography
              textColor="neutral500"
              style={{ fontSize: '13px', whiteSpace: 'nowrap' }}
            >
              {field.unit}
            </Typography>
          </Flex>
          {hasError && (
            <Typography
              style={{ color: '#d02b20', fontSize: '12px', marginTop: '4px', display: 'block' }}
            >
              {fieldError}
            </Typography>
          )}
          <Typography
            textColor="neutral400"
            style={{ fontSize: '11px', marginTop: '4px', display: 'block' }}
          >
            Range: {field.min}–{field.max}
          </Typography>
        </Box>
      </Flex>
    </Box>
  );
};

const BoolRow = ({ field, value, onChange }) => (
  <Box
    paddingTop={3}
    paddingBottom={3}
    style={{ borderBottom: '1px solid #f0f0f3' }}
  >
    <Flex gap={4} alignItems="flex-start" style={{ flexWrap: 'wrap' }}>
      {/* Label + description column */}
      <Box style={{ flex: '1 1 260px', minWidth: '200px' }}>
        <Typography
          style={{ fontSize: '14px', fontWeight: 600, display: 'block', marginBottom: '2px' }}
        >
          {field.label}
        </Typography>
        <Typography
          textColor="neutral500"
          style={{ fontSize: '12px', lineHeight: '1.5' }}
        >
          {field.description}
        </Typography>
      </Box>

      {/* Toggle column */}
      <Box style={{ flex: '0 0 auto', paddingTop: '2px' }}>
        <button
          role="switch"
          aria-checked={value}
          onClick={() => onChange(field.key, !value)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {/* Track */}
          <span
            style={{
              display: 'inline-block',
              width: '40px',
              height: '22px',
              borderRadius: '11px',
              background: value ? '#4945ff' : '#dcdce4',
              position: 'relative',
              transition: 'background 0.2s',
              flexShrink: 0,
            }}
          >
            {/* Thumb */}
            <span
              style={{
                position: 'absolute',
                top: '3px',
                left: value ? '21px' : '3px',
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: '#fff',
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }}
            />
          </span>
          <Typography
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: value ? '#4945ff' : '#8e8ea9',
            }}
          >
            {value ? 'On' : 'Off'}
          </Typography>
        </button>
      </Box>
    </Flex>
  </Box>
);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(form) {
  const errors = {};
  GROUPS.forEach(({ fields = [] }) => {
    fields.forEach(({ key, label, min, max }) => {
      const raw = form[key];
      if (raw === '' || raw === undefined || raw === null) return; // optional
      const n = Number(raw);
      if (!Number.isInteger(n) || n < min || n > max) {
        errors[key] = `Must be a whole number between ${min} and ${max}`;
      }
    });
  });
  return errors;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const PolicySection = () => {
  const { policy, loading, error, saving, saveError, savePolicy } = usePolicy();
  const [form, setForm]             = useState({});
  const [dirty, setDirty]           = useState(false);
  const [success, setSuccess]       = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [stepUpOpen, setStepUpOpen] = useState(false);

  // Populate form when policy loads
  useEffect(() => {
    if (policy) {
      const init = {};
      GROUPS.forEach(({ fields = [], boolFields = [] }) => {
        fields.forEach(({ key })     => { init[key] = policy[key] ?? ''; });
        boolFields.forEach(({ key }) => { init[key] = policy[key] ?? false; });
      });
      setForm(init);
      setDirty(false);
      setFieldErrors({});
    }
  }, [policy]);

  const handleNumeric = (key, val) => {
    setForm((f) => ({ ...f, [key]: val === '' ? '' : Number(val) }));
    setDirty(true);
    setSuccess(false);
    // Clear field error on change
    setFieldErrors((e) => { const next = { ...e }; delete next[key]; return next; });
  };

  const handleBool = (key, val) => {
    setForm((f) => ({ ...f, [key]: val }));
    setDirty(true);
    setSuccess(false);
  };

  const doSave = async (stepUpToken) => {
    const errors = validate(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const fields = { ...form };
    GROUPS.forEach(({ fields: fds = [] }) => {
      fds.forEach(({ key }) => {
        if (fields[key] === '') delete fields[key];
      });
    });

    const result = await savePolicy(fields, stepUpToken);
    if (result.stepUpRequired) {
      setStepUpOpen(true);
      return;
    }
    if (result.success) {
      setSuccess(true);
      setDirty(false);
      setTimeout(() => setSuccess(false), 5000);
    }
  };

  const handleStepUpSuccess = async (token) => {
    setStepUpOpen(false);
    await doSave(token);
  };

  if (loading) {
    return (
      <Box>
        <Typography variant="beta" as="h2" marginBottom={4}>Security Policy</Typography>
        <Loader>Loading policy…</Loader>
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        <Typography variant="beta" as="h2" marginBottom={4}>Security Policy</Typography>
        <Alert variant="danger" title="Failed to load policy" closeLabel="Dismiss">
          {error.message}
        </Alert>
      </Box>
    );
  }

  const hasFieldErrors = Object.keys(fieldErrors).length > 0;

  return (
    <Box>
      <Typography variant="beta" as="h2" marginBottom={2}>
        Security Policy
      </Typography>
      <Typography textColor="neutral500" style={{ fontSize: '14px', marginBottom: '24px', display: 'block' }}>
        Live policy values stored in the database. Changes take effect within 5 minutes.
      </Typography>

      {success && (
        <Box marginBottom={4}>
          <Alert variant="success" title="Policy saved" closeLabel="Dismiss" onClose={() => setSuccess(false)}>
            Security policy updated successfully.
          </Alert>
        </Box>
      )}

      {saveError && !stepUpOpen && (
        <Box marginBottom={4}>
          <Alert variant="danger" title="Save failed" closeLabel="Dismiss" onClose={() => {}}>
            {saveError.message}
          </Alert>
        </Box>
      )}

      {hasFieldErrors && (
        <Box marginBottom={4}>
          <Alert variant="danger" title="Validation errors" closeLabel="Dismiss" onClose={() => setFieldErrors({})}>
            Please fix the highlighted fields before saving.
          </Alert>
        </Box>
      )}

      {/* Grouped sections */}
      {GROUPS.map((group) => (
        <SectionCard key={group.title} title={group.title} description={group.description}>
          {(group.fields || []).map((field) => (
            <FieldRow
              key={field.key}
              field={field}
              value={form[field.key]}
              onChange={handleNumeric}
              error={fieldErrors[field.key]}
            />
          ))}
          {(group.boolFields || []).map((field) => (
            <BoolRow
              key={field.key}
              field={field}
              value={Boolean(form[field.key])}
              onChange={handleBool}
            />
          ))}
        </SectionCard>
      ))}

      {/* Save bar */}
      <Box
        background="neutral0"
        borderRadius="4px"
        padding={4}
        style={{
          border: '1px solid #dcdce4',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
        }}
      >
        <Typography textColor="neutral500" style={{ fontSize: '13px' }}>
          {dirty
            ? 'You have unsaved changes.'
            : 'All changes saved.'}
        </Typography>
        <Button
          onClick={() => doSave(null)}
          loading={saving}
          disabled={!dirty || saving}
        >
          Save Policy
        </Button>
      </Box>

      <StepUpModal
        isOpen={stepUpOpen}
        onClose={() => setStepUpOpen(false)}
        onSuccess={handleStepUpSuccess}
        actionLabel="save security policy"
      />
    </Box>
  );
};

export default PolicySection;
