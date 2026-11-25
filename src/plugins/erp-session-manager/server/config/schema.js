'use strict';

/**
 * AJV JSON Schema for the erp-session-manager plugin configuration.
 * Used by Config_Validator at Strapi bootstrap to validate the resolved config.
 * Any violation produces a human-readable per-field error and halts startup.
 *
 * References: Design §4.3, Req 1.4, Req 17.3, Req 17.4
 */

const CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    store: {
      type: 'object',
      properties: {
        database: {
          type: 'object',
          properties: {
            enabled:         { type: 'boolean', default: false },
            // How often to purge expired rows (milliseconds). Default: 1 hour.
            purgeIntervalMs: { type: 'integer', minimum: 60000, default: 3600000 },
          },
        },
        redis: {
          type: 'object',
          properties: {
            enabled:    { type: 'boolean', default: false },
            url:        { type: 'string' },
            host:       { type: 'string', default: '127.0.0.1' },
            port:       { type: 'integer', minimum: 1, maximum: 65535, default: 6379 },
            password:   { type: 'string' },
            db:         { type: 'integer', minimum: 0, default: 0 },
            maxRetries: { type: 'integer', minimum: 0, default: 10 },
            sentinels:  { type: 'array', items: { type: 'object' } },
            cluster:    { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
    tokens: {
      type: 'object',
      properties: {
        accessTokenTtl:  { type: 'integer', minimum: 60, default: 900 },
        refreshTokenTtl: { type: 'integer', minimum: 300, default: 28800 },
        signingKeys:     { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
    },
    sessions: {
      type: 'object',
      properties: {
        idleTimeout:     { type: 'integer', minimum: 60, default: 1800 },
        absoluteTimeout: { type: 'integer', minimum: 300, default: 28800 },
        maxConcurrent:   { type: 'integer', minimum: 1, default: 3 },
        evictionPolicy:  { type: 'string', enum: ['oldest-first', 'reject-new'], default: 'oldest-first' },
        anomaly: {
          type: 'object',
          properties: {
            blockOnIpChange:         { type: 'boolean', default: true },
            blockOnUaChange:         { type: 'boolean', default: false },
            impossibleTravelEnabled: { type: 'boolean', default: false },
            maxSpeedKmh:             { type: 'number', default: 900 },
          },
        },
      },
    },
    cookies: {
      type: 'object',
      properties: {
        name:     { type: 'string',  default: 'erp_rt' },
        domain:   { type: 'string' },
        sameSite: { type: 'string',  enum: ['Strict', 'Lax', 'None'], default: 'Strict' },
        httpOnly: { type: 'boolean', default: true },
        secure:   { type: 'boolean' },
      },
    },
    hsts: {
      type: 'object',
      properties: {
        enabled:           { type: 'boolean', default: true },
        maxAge:            { type: 'integer', minimum: 0, default: 31536000 },
        includeSubDomains: { type: 'boolean', default: true },
        preload:           { type: 'boolean', default: false },
      },
    },
    password: {
      type: 'object',
      properties: {
        minLength:              { type: 'integer', minimum: 8, default: 12 },
        maxLength:              { type: 'integer', minimum: 16, default: 128 },
        requireUppercase:       { type: 'boolean', default: true },
        requireLowercase:       { type: 'boolean', default: true },
        requireDigit:           { type: 'boolean', default: true },
        requireSpecial:         { type: 'boolean', default: true },
        specialChars:           { type: 'string', default: '!@#$%^&*()_+-=[]{}|;\':",./<>?' },
        preventCommonPasswords: { type: 'boolean', default: true },
        // VAPT #27: 0 = disabled; N > 0 = block reuse of last N passwords
        passwordHistory: { type: 'integer', minimum: 0, default: 5 },
      },
    },
    auditLog: {
      type: 'object',
      properties: {
        retentionDays: { type: 'integer', minimum: 1, default: 90 },
      },
    },
    rateLimiting: {
      type: 'object',
      properties: {
        login: {
          type: 'object',
          properties: {
            windowMs:    { type: 'integer', minimum: 1000, default: 900000 },
            maxAttempts: { type: 'integer', minimum: 1, default: 10 },
          },
        },
        register: {
          type: 'object',
          properties: {
            windowMs:    { type: 'integer', minimum: 1000, default: 3600000 },
            maxAttempts: { type: 'integer', minimum: 1, default: 5 },
          },
        },
      },
    },
    stepUp: {
      type: 'object',
      properties: {
        enabled:          { type: 'boolean', default: false },
        tokenTtl:         { type: 'integer', minimum: 60, default: 300 },
        maxAttempts:      { type: 'integer', minimum: 1, default: 5 },
        windowMs:         { type: 'integer', minimum: 1000, default: 900000 },
        clockSkewSeconds: { type: 'integer', minimum: 0, default: 30 },
        protectedRoutes:  {
          type: 'array',
          items: { type: 'string' },
          default: ['policy_management', 'password_change'],
        },
        // Enforce TOTP for content-API users who have it provisioned (defaults to false)
        enforceForContentApi: { type: 'boolean', default: false },
      },
    },
    // G12: reCAPTCHA v3 for admin login
    recaptcha: {
      type: 'object',
      properties: {
        enabled:   { type: 'boolean', default: false },
        siteKey:   { type: 'string', default: '' },
        secretKey: { type: 'string', default: '' },
        minScore:  { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
      },
    },
    // VAPT #20: image-based SVG CAPTCHA for content-API and admin-panel auth endpoints
    captcha: {
      type: 'object',
      properties: {
        enabled:              { type: 'boolean', default: false },
        enforceForContentApi: { type: 'boolean', default: true },
        enforceForAdminPanel: { type: 'boolean', default: true },
        ttlSeconds:           { type: 'number',  default: 300, minimum: 60, maximum: 3600 },
      },
    },
  },
};

/**
 * Secret field paths that must be redacted when logging the resolved config.
 * Each entry is a dot-separated path relative to the config root.
 */
const SECRET_PATHS = [
  'store.redis.password',
  'store.redis.url',
  'tokens.signingKeys',
  'recaptcha.secretKey',
];

/**
 * Checks whether a Redis URL contains embedded credentials.
 * e.g. redis://:password@host:port or redis://user:pass@host:port
 *
 * @param {string} url
 * @returns {boolean}
 */
function urlContainsCredentials(url) {
  try {
    const parsed = new URL(url);
    return Boolean(parsed.password || parsed.username);
  } catch {
    // If URL is malformed, treat it as potentially sensitive
    return true;
  }
}

/**
 * Deep-clones a plain object/array value.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Returns a deep copy of `config` with all secret fields replaced by '[REDACTED]'.
 *
 * Rules:
 *  - store.redis.password  → '[REDACTED]'
 *  - store.redis.url       → '[REDACTED]' if it contains credentials, otherwise kept
 *  - tokens.signingKeys    → each element replaced with '[REDACTED]'
 *
 * @param {object} config
 * @returns {object}
 */
function redactSecrets(config) {
  const redacted = deepClone(config);
  /** @type {any} */
  const r = redacted;

  // Redact Redis password
  if (r.store && r.store.redis && r.store.redis.password !== undefined) {
    r.store.redis.password = '[REDACTED]';
  }

  // Redact Redis URL if it contains credentials
  if (r.store && r.store.redis && typeof r.store.redis.url === 'string') {
    if (urlContainsCredentials(r.store.redis.url)) {
      r.store.redis.url = '[REDACTED]';
    }
  }

  // Redact each signing key value
  if (r.tokens && Array.isArray(r.tokens.signingKeys)) {
    r.tokens.signingKeys = r.tokens.signingKeys.map(() => '[REDACTED]');
  }

  return r;
}

/**
 * Converts an AJV error object into a human-readable message.
 *
 * @param {{ instancePath: string, message: string, params?: object }} error
 * @returns {string}
 */
function formatAjvError(error) {
  // instancePath is empty for root-level errors; use 'config' as fallback
  const path = error.instancePath
    ? `config${error.instancePath.replace(/\//g, '.')}`
    : 'config';
  return `erp-session-manager config error: ${path} ${error.message}`;
}

/**
 * Config_Validator
 *
 * Validates the fully-resolved plugin config against CONFIG_SCHEMA using AJV.
 * Produces human-readable per-field errors and throws (halting startup) on any
 * violation.  After schema validation, performs a custom check for Redis
 * connectivity settings.  Logs the full resolved config at debug level with
 * secrets replaced by '[REDACTED]'.
 *
 * Usage (called from server/index.js bootstrap):
 *
 *   const { Config_Validator } = require('./config/schema');
 *   Config_Validator.validate(resolvedConfig, strapi);
 *
 * References: Req 1.4, Req 1.7, Req 17.3, Req 17.4, Req 17.7
 */
const Config_Validator = {
  /**
   * Validates `config` and logs the redacted version.
   * Throws an Error (halting Strapi startup) if any violation is found.
   *
   * @param {object} config  — fully-resolved plugin config (defaults merged)
   * @param {{ log: { debug: Function, error: Function } }} strapi — Strapi instance
   * @throws {Error} if config is invalid
   */
  validate(config, strapi) {
    // AJV 8 ships its constructor as the default export.
    // When bundled with CommonJS interop the constructor lives on `.default`.
    const AjvModule = require('ajv');
    /** @type {any} */
    const AjvConstructor = AjvModule.default || AjvModule;
    const ajv = new AjvConstructor({ allErrors: true, useDefaults: true });

    const validate = ajv.compile(CONFIG_SCHEMA);
    const valid = validate(config);

    if (!valid) {
      const messages = (validate.errors || []).map(formatAjvError);

      // Log each error individually so operators can see all problems at once
      for (const msg of messages) {
        strapi.log.error(msg);
      }

      throw new Error(
        `erp-session-manager failed to start: ${messages.length} config error(s) found.\n` +
        messages.join('\n')
      );
    }

    // Custom check: when Redis is enabled, url OR (host AND port) must be present
    // (Req 1.7)
    /** @type {any} */
    const cfg = config;
    const redis = cfg.store && cfg.store.redis;
    if (redis && redis.enabled) {
      const hasUrl = typeof redis.url === 'string' && redis.url.length > 0;
      const hasHostPort =
        typeof redis.host === 'string' && redis.host.length > 0 &&
        typeof redis.port === 'number';

      if (!hasUrl && !hasHostPort) {
        const msg =
          'erp-session-manager config error: store.redis is enabled but neither ' +
          'store.redis.url nor store.redis.host/port are configured';
        strapi.log.error(msg);
        throw new Error(msg);
      }
    }

    // Log full resolved config at debug level with secrets redacted (Req 17.7)
    const redacted = redactSecrets(config);
    strapi.log.debug(
      '[erp-session-manager] Resolved config: ' + JSON.stringify(redacted, null, 2)
    );
  },
};

module.exports = {
  CONFIG_SCHEMA,
  SECRET_PATHS,
  redactSecrets,
  formatAjvError,
  Config_Validator,
};
