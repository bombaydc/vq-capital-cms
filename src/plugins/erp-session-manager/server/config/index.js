'use strict';

/**
 * Default configuration values for erp-session-manager.
 *
 * Strapi merges these defaults with the project's config/plugins.js values
 * before calling the `validator` function.  Every value here represents a
 * secure default per NIST SP 800-63B-4 and OWASP Session Management
 * Cheat Sheet.
 *
 * References: Req 1.2, Req 1.3, Design §4.3, Design §2.3 step 1
 */

const { Config_Validator } = require('./schema');

module.exports = {
  /**
   * Secure default values.  These are deep-merged with the operator's
   * config/plugins.js['erp-session-manager'].config object by Strapi before
   * the validator is called.
   */
  default: {
    store: {
      redis: {
        enabled:    false,
        host:       '127.0.0.1',
        port:       6379,
        db:         0,
        maxRetries: 10,
      },
    },

    tokens: {
      accessTokenTtl:  900,    // 15 minutes (NIST SP 800-63B-4 §7.2)
      refreshTokenTtl: 28800,  // 8 hours
      signingKeys:     ['change-me-in-production'],  // Operator should override this
    },

    sessions: {
      idleTimeout:     900,    // 15 minutes (ERP standard)
      absoluteTimeout: 14400,  // 4 hours (ERP standard)
      maxConcurrent:   2,      // ERP standard
      evictionPolicy:  'oldest-first',
      anomaly: {
        blockOnIpChange:         true,
        blockOnUaChange:         false,
        impossibleTravelEnabled: false,
        maxSpeedKmh:             900,
      },
    },

    cookies: {
      name:     'erp_rt',
      sameSite: 'Strict',
    },

    hsts: {
      enabled:           true,
      maxAge:            31536000, // 1 year (OWASP HSTS recommendation)
      includeSubDomains: true,
      preload:           false,
    },

    password: {
      minLength:              12,
      maxLength:              128,
      requireUppercase:       true,
      requireLowercase:       true,
      requireDigit:           true,
      requireSpecial:         true,
      specialChars:           '!@#$%^&*()_+-=[]{}|;\':",./<>?',
      preventCommonPasswords: true,
      passwordHistory: 5,   // VAPT #27: block reuse of last 5 passwords (0 = disabled)
    },

    auditLog: {
      retentionDays: 90,
    },

    rateLimiting: {
      login: {
        windowMs:    900000,   // 15 minutes
        maxAttempts: 10,
      },
      register: {
        windowMs:    3600000,  // 1 hour
        maxAttempts: 5,
      },
    },

    stepUp: {
      enabled:          false,
      tokenTtl:         300,    // 5 minutes
      maxAttempts:      5,
      windowMs:         900000, // 15 minutes
      clockSkewSeconds: 30,
      // user_management / role_management removed on request — neither users
      // nor roles are gated. password_change covers only the signed-in admin
      // changing their own password.
      protectedRoutes:      ['policy_management', 'password_change'],
      enforceForContentApi: false,
    },

    recaptcha: {
      enabled:   false,
      siteKey:   '',
      secretKey: '',
      minScore:  0.5,
    },

    // VAPT #20 — image-based SVG CAPTCHA for content-API and admin-panel auth endpoints
    captcha: {
      enabled:              false,
      enforceForContentApi: true,
      enforceForAdminPanel: true,
      ttlSeconds:           300,
    },
  },

  /**
   * Strapi calls this function with the fully-resolved config (defaults merged
   * with operator overrides) during plugin bootstrap.
   *
   * Delegates to Config_Validator which:
   *  1. Validates the config against the AJV JSON Schema (Req 1.4, Req 17.3)
   *  2. Performs a custom Redis connectivity check (Req 1.7)
   *  3. Logs the redacted config at debug level (Req 17.7)
   *  4. Throws (halting startup) on any violation (Req 17.4)
   *
   * NOTE: Strapi's plugin config system does not pass the `strapi` instance to
   * this function.  Full validation (including logging) is therefore also
   * invoked explicitly from server/index.js bootstrap() once `strapi` is
   * available.  This function performs a lightweight schema-only check so that
   * Strapi's own config loading can surface obvious errors early.
   *
   * @param {object} config — fully-resolved plugin config
   * @returns {object} the same config object (Strapi expects it returned)
   */
  validator(config) {
    // Lightweight early check: use a minimal no-op logger so we can reuse
    // Config_Validator without a real strapi instance at this stage.
    const silentStrapi = {
      log: {
        debug: () => {},
        error: () => {},
      },
    };

    Config_Validator.validate(config, silentStrapi);

    return config;
  },
};
