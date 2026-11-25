/**
 * erp-session-manager — Example plugin configuration
 *
 * Copy the object below into your project's config/plugins.js under the
 * 'erp-session-manager' key.  Every option shown here is optional — secure
 * defaults are applied for any key that is omitted.
 *
 * Usage in config/plugins.js:
 *
 *   module.exports = ({ env }) => ({
 *     'erp-session-manager': {
 *       enabled: true,
 *       config: { ...options below... },
 *     },
 *   });
 */

module.exports = {
  // ─── Store ────────────────────────────────────────────────────────────────
  store: {
    redis: {
      /**
       * enabled {boolean} — default: false
       * Set to true to activate the Redis-backed session store.
       * When false the in-memory store is used regardless of all other
       * store.redis.* values.  Switch by restarting Strapi; no migration
       * is performed — existing in-memory sessions are naturally lost.
       */
      enabled: false,

      /**
       * url {string} — optional
       * Full Redis connection URL, e.g. "redis://:password@127.0.0.1:6379/0".
       * When provided, url takes precedence over host/port/password/db.
       * Required (together with host/port) when enabled is true.
       */
      // url: 'redis://127.0.0.1:6379/0',

      /**
       * host {string} — default: '127.0.0.1'
       * Redis server hostname or IP address.
       */
      host: '127.0.0.1',

      /**
       * port {integer} — default: 6379  range: 1–65535
       * Redis server port.
       */
      port: 6379,

      /**
       * password {string} — optional
       * Redis AUTH password.
       */
      // password: 'your-redis-password',

      /**
       * db {integer} — default: 0  range: 0–15
       * Redis logical database index.
       */
      db: 0,

      /**
       * maxRetries {integer} — default: 10  range: 0+
       * Maximum number of reconnection attempts after a mid-operation Redis
       * outage before the plugin gives up and stays on the in-memory fallback.
       * Reconnection uses exponential backoff: initial 100 ms, max 30 s.
       */
      maxRetries: 10,

      /**
       * sentinels {Array<{ host, port }>} — optional
       * Redis Sentinel topology.  Provide an array of sentinel nodes.
       * Example: [{ host: '10.0.0.1', port: 26379 }]
       */
      // sentinels: [],

      /**
       * cluster {Array<{ host, port }>} — optional
       * Redis Cluster topology.  Provide an array of cluster nodes.
       * Example: [{ host: '10.0.0.1', port: 7000 }, { host: '10.0.0.2', port: 7001 }]
       */
      // cluster: [],
    },
  },

  // ─── Tokens ───────────────────────────────────────────────────────────────
  tokens: {
    /**
     * accessTokenTtl {integer} — default: 900  unit: seconds  min: 60
     * Lifespan of the short-lived JWT access token.
     * OWASP recommends 15 minutes (900 s) for high-value systems.
     */
    accessTokenTtl: 900,

    /**
     * refreshTokenTtl {integer} — default: 28800  unit: seconds  min: 300
     * Lifespan of the opaque refresh token stored server-side.
     * Default is 8 hours.  Also used as the Redis TTL for session records.
     */
    refreshTokenTtl: 28800,

    /**
     * signingKeys {string[]} — required in production  minItems: 1
     * Array of HMAC secrets used to sign and verify JWTs.
     * The FIRST key is the active signing key; subsequent keys are accepted
     * for verification only (zero-downtime key rotation).
     * A startup warning is logged when only one key is present.
     *
     * Generate a key:  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
     */
    // signingKeys: [process.env.JWT_SIGNING_KEY_PRIMARY, process.env.JWT_SIGNING_KEY_OLD],
  },

  // ─── Sessions ─────────────────────────────────────────────────────────────
  sessions: {
    /**
     * idleTimeout {integer} — default: 1800  unit: seconds  min: 60
     * Maximum inactivity period before a session is automatically invalidated.
     * OWASP recommended range for high-value systems: 120–300 s.
     */
    idleTimeout: 1800,

    /**
     * absoluteTimeout {integer} — default: 28800  unit: seconds  min: 300
     * Maximum total session duration regardless of activity.
     * OWASP recommended range: 14400–28800 s (4–8 hours).
     */
    absoluteTimeout: 28800,

    /**
     * maxConcurrent {integer} — default: 3  min: 1
     * Maximum number of simultaneous active sessions per user.
     */
    maxConcurrent: 3,

    /**
     * evictionPolicy {string} — default: 'oldest-first'
     * Policy applied when a new login would exceed maxConcurrent.
     *   'oldest-first' — revoke the session with the earliest issuedAt
     *   'reject-new'   — deny the new login with HTTP 429
     */
    evictionPolicy: 'oldest-first',

    anomaly: {
      /**
       * blockOnIpChange {boolean} — default: true
       * Revoke session and return HTTP 401 when the request IP differs from
       * the IP recorded at session creation.
       */
      blockOnIpChange: true,

      /**
       * blockOnUaChange {boolean} — default: false
       * Revoke session and return HTTP 401 when the User-Agent header differs
       * from the one recorded at session creation.
       */
      blockOnUaChange: false,

      /**
       * impossibleTravelEnabled {boolean} — default: false
       * Enable impossible-travel detection using the local MaxMind GeoLite2
       * database.  Requires the GeoLite2-City.mmdb file to be present.
       * When the database is unavailable the check is silently skipped.
       */
      impossibleTravelEnabled: false,

      /**
       * maxSpeedKmh {number} — default: 900
       * Maximum plausible travel speed in km/h used for impossible-travel
       * detection.  900 km/h approximates commercial air travel.
       */
      maxSpeedKmh: 900,
    },
  },

  // ─── Cookies ──────────────────────────────────────────────────────────────
  cookies: {
    /**
     * name {string} — default: 'erp_rt'
     * Name of the HttpOnly refresh-token cookie.
     */
    name: 'erp_rt',

    /**
     * domain {string} — optional
     * Cookie Domain attribute.  Omit to let the browser default to the
     * current host (recommended for single-domain deployments).
     */
    // domain: '.example.com',

    /**
     * sameSite {string} — default: 'Strict'
     * Cookie SameSite attribute.  Allowed values: 'Strict', 'Lax', 'None'.
     * 'None' requires Secure=true and should only be used for cross-site
     * scenarios (e.g. embedded iframes).
     */
    sameSite: 'Strict',
  },

  // ─── HSTS ─────────────────────────────────────────────────────────────────
  hsts: {
    /**
     * enabled {boolean} — default: true
     * Set to false in local development environments to suppress the
     * Strict-Transport-Security header.
     */
    enabled: true,

    /**
     * maxAge {integer} — default: 31536000  unit: seconds  min: 0
     * Value of the max-age directive.  31536000 = 1 year (HSTS preload minimum).
     */
    maxAge: 31536000,

    /**
     * includeSubDomains {boolean} — default: true
     * Append the includeSubDomains directive to the HSTS header.
     */
    includeSubDomains: true,

    /**
     * preload {boolean} — default: false
     * Append the preload directive.  Only set to true after submitting your
     * domain to the HSTS preload list (https://hstspreload.org).
     */
    preload: false,
  },

  // ─── Password Policy ──────────────────────────────────────────────────────
  password: {
    /**
     * minLength {integer} — default: 12  min: 8
     * Minimum password length in characters.
     */
    minLength: 12,

    /**
     * maxLength {integer} — default: 128  min: 16
     * Maximum password length in characters.  Prevents bcrypt DoS attacks.
     */
    maxLength: 128,

    /**
     * requireUppercase {boolean} — default: true
     * Require at least one uppercase letter (A–Z).
     */
    requireUppercase: true,

    /**
     * requireLowercase {boolean} — default: true
     * Require at least one lowercase letter (a–z).
     */
    requireLowercase: true,

    /**
     * requireDigit {boolean} — default: true
     * Require at least one numeric digit (0–9).
     */
    requireDigit: true,

    /**
     * requireSpecial {boolean} — default: true
     * Require at least one character from the specialChars set.
     */
    requireSpecial: true,

    /**
     * specialChars {string} — default: '!@#$%^&*()_+-=[]{}|;\':",./<>?'
     * The set of characters considered "special" for the requireSpecial rule.
     */
    specialChars: '!@#$%^&*()_+-=[]{}|;\':",./<>?',

    /**
     * preventCommonPasswords {boolean} — default: true
     * Reject passwords found in the bundled list of the 10,000 most common
     * passwords (binary search, O(log n)).
     */
    preventCommonPasswords: true,
  },

  // ─── Audit Log ────────────────────────────────────────────────────────────
  auditLog: {
    /**
     * retentionDays {integer} — default: 90  min: 1
     * Number of days to retain audit log entries.  Entries older than this
     * value are deleted by a daily scheduled cleanup task.
     */
    retentionDays: 90,
  },

  // ─── Rate Limiting ────────────────────────────────────────────────────────
  rateLimiting: {
    login: {
      /**
       * windowMs {integer} — default: 900000  unit: ms  min: 1000
       * Sliding window duration for login rate limiting.
       * Default is 15 minutes (900,000 ms).
       */
      windowMs: 900000,

      /**
       * maxAttempts {integer} — default: 10  min: 1
       * Maximum number of failed login attempts per IP (and per user account)
       * within windowMs before HTTP 429 is returned.
       */
      maxAttempts: 10,
    },

    register: {
      /**
       * windowMs {integer} — default: 3600000  unit: ms  min: 1000
       * Sliding window duration for registration rate limiting.
       * Default is 1 hour (3,600,000 ms).
       */
      windowMs: 3600000,

      /**
       * maxAttempts {integer} — default: 5  min: 1
       * Maximum number of registration attempts per IP within windowMs.
       */
      maxAttempts: 5,
    },
  },

  // ─── Step-Up Authentication ───────────────────────────────────────────────
  stepUp: {
    /**
     * enabled {boolean} — default: false
     * Master switch. When false, step-up middleware is bypassed entirely.
     * Set to true to enforce TOTP MFA on sensitive admin routes.
     */
    enabled: false,

    /**
     * tokenTtl {integer} — default: 300  unit: seconds  min: 60
     * Validity window for issued step-up tokens.
     * After this period the token is rejected even if unused.
     */
    tokenTtl: 300,

    /**
     * maxAttempts {integer} — default: 5  min: 1
     * Maximum failed TOTP attempts per windowMs before HTTP 429 is returned.
     */
    maxAttempts: 5,

    /**
     * windowMs {integer} — default: 900000  unit: ms  min: 1000
     * Sliding window for failed TOTP attempt rate limiting.
     * Default is 15 minutes (900,000 ms).
     */
    windowMs: 900000,

    /**
     * clockSkewSeconds {integer} — default: 30  min: 0
     * TOTP clock skew tolerance in seconds (±1 window = ±30s by default).
     * Accommodates minor clock drift between server and authenticator app.
     */
    clockSkewSeconds: 30,

    /**
     * protectedRoutes {string[]} — default: ['user_management', 'role_management', 'policy_management']
     * Route groups that require a valid step-up token.
     * Built-in groups: 'user_management', 'role_management', 'policy_management'.
     */
    protectedRoutes: ['user_management', 'role_management', 'policy_management'],
  },
};
