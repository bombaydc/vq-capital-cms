import { Box, Flex, Typography, Divider } from '@strapi/design-system';
import { CheckCircle, CrossCircle } from '@strapi/icons';

const Row = ({ label, value }) => (
  <Flex gap={4} paddingTop={2} paddingBottom={2} borderColor="neutral150" borderStyle="solid" borderWidth="0 0 1px 0">
    <Box minWidth="220px" flexShrink={0}>
      <Typography variant="omega" textColor="neutral500">{label}</Typography>
    </Box>
    <Typography variant="omega" textColor="neutral800">{value ?? '—'}</Typography>
  </Flex>
);

const BoolRow = ({ label, value }) => (
  <Flex gap={4} paddingTop={2} paddingBottom={2} borderColor="neutral150" borderStyle="solid" borderWidth="0 0 1px 0" alignItems="center">
    <Box minWidth="220px" flexShrink={0}>
      <Typography variant="omega" textColor="neutral500">{label}</Typography>
    </Box>
    <Flex gap={2} alignItems="center">
      {value
        ? <CheckCircle fill="success600" width="16px" height="16px" />
        : <CrossCircle fill="danger600" width="16px" height="16px" />}
      <Typography variant="omega" textColor={value ? 'success600' : 'danger600'}>
        {value ? 'Enabled' : 'Disabled'}
      </Typography>
    </Flex>
  </Flex>
);

const SectionTitle = ({ children }) => (
  <Box marginTop={5} marginBottom={2}>
    <Typography variant="sigma" textColor="neutral500" textTransform="uppercase">{children}</Typography>
    <Divider marginTop={2} />
  </Box>
);

const fmtSec = (s) => {
  if (!s && s !== 0) return '—';
  if (s >= 3600) return `${s}s (${Math.round(s / 3600)}h)`;
  if (s >= 60)   return `${s}s (${Math.round(s / 60)}min)`;
  return `${s}s`;
};

const fmtMs = (ms) => {
  if (!ms && ms !== 0) return '—';
  if (ms >= 3600000) return `${ms}ms (${Math.round(ms / 3600000)}h)`;
  if (ms >= 60000)   return `${ms}ms (${Math.round(ms / 60000)}min)`;
  return `${ms}ms`;
};

const ConfigSection = ({ config }) => {
  if (!config) return (
    <Typography variant="omega" textColor="neutral500">Loading configuration…</Typography>
  );

  const { store, tokens, sessions, cookies, hsts, password, auditLog, rateLimiting } = config;
  const redis = store?.redis || {};
  const anomaly = sessions?.anomaly || {};
  const login = rateLimiting?.login || {};
  const register = rateLimiting?.register || {};

  return (
    <Box>
      {/* Store */}
      <SectionTitle>Store</SectionTitle>
      <BoolRow label="Redis Enabled" value={redis.enabled} />
      {redis.enabled && <Row label="Redis Host" value={redis.host} />}
      {redis.enabled && <Row label="Redis Port" value={redis.port} />}
      {redis.enabled && <Row label="Max Retries" value={redis.maxRetries} />}

      {/* Tokens */}
      <SectionTitle>Tokens</SectionTitle>
      <Row label="Access Token TTL" value={fmtSec(tokens?.accessTokenTtl)} />
      <Row label="Refresh Token TTL" value={fmtSec(tokens?.refreshTokenTtl)} />
      <Row label="Signing Keys" value={`${tokens?.signingKeys?.length || 0} key(s) configured`} />

      {/* Sessions */}
      <SectionTitle>Sessions</SectionTitle>
      <Row label="Idle Timeout" value={fmtSec(sessions?.idleTimeout)} />
      <Row label="Absolute Timeout" value={fmtSec(sessions?.absoluteTimeout)} />
      <Row label="Max Concurrent" value={`${sessions?.maxConcurrent} per user`} />
      <Row label="Eviction Policy" value={sessions?.evictionPolicy} />
      <BoolRow label="Block on IP Change" value={anomaly.blockOnIpChange} />
      <BoolRow label="Block on UA Change" value={anomaly.blockOnUaChange} />
      <BoolRow label="Impossible Travel" value={anomaly.impossibleTravelEnabled} />
      {anomaly.impossibleTravelEnabled && <Row label="Max Speed" value={`${anomaly.maxSpeedKmh} km/h`} />}

      {/* Cookies */}
      <SectionTitle>Cookies</SectionTitle>
      <Row label="Cookie Name" value={cookies?.name} />
      <Row label="SameSite" value={cookies?.sameSite} />
      {cookies?.domain && <Row label="Domain" value={cookies.domain} />}

      {/* HSTS */}
      <SectionTitle>HSTS</SectionTitle>
      <BoolRow label="Enabled" value={hsts?.enabled} />
      <Row label="Max-Age" value={fmtSec(hsts?.maxAge)} />
      <BoolRow label="Include Subdomains" value={hsts?.includeSubDomains} />
      <BoolRow label="Preload" value={hsts?.preload} />

      {/* Password Policy */}
      <SectionTitle>Password Policy</SectionTitle>
      <Row label="Min Length" value={`${password?.minLength} characters`} />
      <Row label="Max Length" value={`${password?.maxLength} characters`} />
      <BoolRow label="Require Uppercase" value={password?.requireUppercase} />
      <BoolRow label="Require Lowercase" value={password?.requireLowercase} />
      <BoolRow label="Require Digit" value={password?.requireDigit} />
      <BoolRow label="Require Special" value={password?.requireSpecial} />
      <BoolRow label="Block Common Passwords" value={password?.preventCommonPasswords} />

      {/* Audit Log */}
      <SectionTitle>Audit Log</SectionTitle>
      <Row label="Retention" value={`${auditLog?.retentionDays} days`} />

      {/* Rate Limiting */}
      <SectionTitle>Rate Limiting</SectionTitle>
      <Row label="Login Window" value={fmtMs(login.windowMs)} />
      <Row label="Login Max Attempts" value={login.maxAttempts} />
      <Row label="Register Window" value={fmtMs(register.windowMs)} />
      <Row label="Register Max Attempts" value={register.maxAttempts} />
    </Box>
  );
};

export default ConfigSection;
