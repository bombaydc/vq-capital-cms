'use strict';

/**
 * erp-session-manager — Server plugin entry point
 *
 * Exports the three Strapi plugin lifecycle hooks plus all plugin components
 * (content types, services, controllers, routes, middlewares, policies).
 *
 * Lifecycle order (Design §2.3):
 *   register()  → validate config, register global middlewares
 *   bootstrap() → init store, load GeoLite2, register hooks, schedule cron
 *   destroy()   → close Redis, log shutdown
 *
 * References: Req 1.1, Req 13.6, Req 14.5, Design §2.3, Design §11.1–11.4
 */

const path = require('path');

const storeModule             = require('./services/store');
const geo                     = require('./utils/geo');
const { redactSecrets }       = require('./config/schema');

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

/**
 * register({ strapi })
 *
 * Called before bootstrap. Config validation is delegated to the
 * validator() function in server/config/index.js, which Strapi invokes
 * automatically during plugin loading.
 *
 * @param {{ strapi: object }} param0
 */
function register({ strapi }) {
  // Config validation is handled by the validator() function in server/config/index.js,
  // which Strapi calls automatically during plugin loading (before register() runs).

  // G16/G17: Register custom RBAC actions for this plugin
  try {
    strapi.admin.services.permission.actionProvider.registerMany([
      {
        section:     'plugins',
        displayName: 'View Sessions',
        uid:         'sessions.read',
        pluginName:  'erp-session-manager',
      },
      {
        section:     'plugins',
        displayName: 'Revoke Sessions',
        uid:         'sessions.revoke',
        pluginName:  'erp-session-manager',
      },
      {
        section:     'plugins',
        displayName: 'View Audit Logs',
        uid:         'audit-logs.read',
        pluginName:  'erp-session-manager',
      },
      {
        section:     'plugins',
        displayName: 'Edit Security Policy',
        uid:         'policy.update',
        pluginName:  'erp-session-manager',
      },
    ]);
  } catch (err) {
    // strapi.log may not be available yet during register — use console
    // eslint-disable-next-line no-console
    console.warn('[erp-session-manager] RBAC registration error:', err.message);
  }
}

/**
 * bootstrap({ strapi })
 *
 * Called after all plugins are registered. Initialises the session store,
 * optionally loads GeoLite2, registers users-permissions hooks, registers
 * the password validation hook, schedules the daily audit log cleanup cron,
 * and logs startup warnings.
 *
 * References: Req 12.1, Req 5.7, Req 13.6, Req 14.5, Req 17.7, Design §11.3–11.4
 *
 * @param {{ strapi: object }} param0
 */
async function bootstrap({ strapi }) {
  const config = strapi.config.get('plugin::erp-session-manager');

  // 1. Init session store (Req 12.1)
  await storeModule.init(config, strapi);

  // 1b. Run Knex migrations for DB indexes and UNIQUE constraints (T24, VAPT #5)
  try {
    await strapi.db.connection.migrate.latest({
      directory: path.join(__dirname, 'migrations'),
      tableName: 'erp_session_manager_migrations',
    });
  } catch (err) {
    strapi.log.warn(`[erp-session-manager] Migration error: ${err.message}`);
  }


  // 1c. Pre-load token revocation set from DB (G9/G10)
  try {
    const tokenRevocationSvc = strapi.plugin('erp-session-manager').service('tokenRevocation');
    await tokenRevocationSvc.initialize();
  } catch (err) {
    strapi.log.warn(`[erp-session-manager] Token revocation init error: ${err.message}`);
  }

  // 2. Global middlewares (HSTS, rate-limit, session-auth) are registered via
  //    Strapi's middleware pipeline in config/middlewares.js — see README.
  //    strapi.server.use() is intentionally NOT called here to avoid stacking
  //    middlewares on hot-reload in development mode.

  // 3. Load GeoLite2 DB if impossibleTravelEnabled (Req 5.7)
  const impossibleTravelEnabled =
    config?.sessions?.anomaly?.impossibleTravelEnabled === true;

  if (impossibleTravelEnabled) {
    try {
      await geo.init(path.join(__dirname, '../data/GeoLite2-City.mmdb'));
    } catch (err) {
      // Failure must not halt startup — log warn and continue (Req 5.7)
      strapi.log.warn(
        `[erp-session-manager] GeoLite2 database failed to load: ${err.message}. ` +
        'Impossible-travel checks will be disabled.'
      );
    }
  }

  // 4. Register admin auth hook (tracks admin panel login/logout sessions)
  const adminAuthHook = strapi.plugin('erp-session-manager').service('adminAuthHook');
  try {
    adminAuthHook.register();
  } catch (err) {
    strapi.log.error(
      `[erp-session-manager] Failed to register admin auth hook: ${err.message}`
    );
  }

  // 4b. Sync the live session policy's idle timeout into Strapi's native admin
  //     session manager so the admin panel honours Settings → Policy WITHOUT a
  //     restart. The 'admin' origin is defined by @strapi/admin's own bootstrap;
  //     ordering between core and plugin bootstrap is not guaranteed, so if the
  //     origin is not yet present we retry shortly after on the next tick range.
  try {
    const policyService = strapi.plugin('erp-session-manager').service('policy');
    const applied = await policyService.syncAdminSession();
    if (!applied) {
      // Admin origin not defined yet — retry once after the boot phase settles.
      setTimeout(() => {
        policyService
          .syncAdminSession()
          .catch((err) => strapi.log.warn(`[erp-session-manager] Deferred admin session sync failed: ${err.message}`));
      }, 5000);
    }
  } catch (err) {
    strapi.log.warn(`[erp-session-manager] Admin session policy sync error: ${err.message}`);
  }

  // 6. Register users-permissions hooks (Design §11.3)
  const usersPermissionsHooks = strapi
    .plugin('erp-session-manager')
    .service('usersPermissionsHooks');

  try {
    usersPermissionsHooks.register();
  } catch (err) {
    // Log error and continue gracefully if users-permissions is not installed (Req 14.5)
    strapi.log.error(
      `[erp-session-manager] Failed to register users-permissions hooks: ${err.message}. ` +
      'Session management features will be disabled.'
    );
  }

  // 5. Register password validation hook (Design §11.4)
  const passwordValidationHook = strapi
    .plugin('erp-session-manager')
    .service('passwordValidationHook');

  try {
    passwordValidationHook.register();
  } catch (err) {
    // Log error and continue gracefully if users-permissions is not installed (Req 14.5)
    strapi.log.error(
      `[erp-session-manager] Failed to register password validation hook: ${err.message}. ` +
      'Password validation features will be disabled.'
    );
  }

  // 5b. VAPT #5 — Email uniqueness lifecycle hooks (app-layer, Req 15.5)
  //
  // These hooks fire on beforeCreate / beforeUpdate for BOTH the Strapi admin
  // user model and the users-permissions content-API user model.  They check
  // the DB for an existing row with the same normalised email address and throw
  // a 400 ApplicationError before the ORM ever issues an INSERT/UPDATE.
  //
  // On UPDATE the row being written must be excluded from the duplicate check,
  // or a user re-saving their own email matches themselves and is rejected.
  // The id comes from `params.where` — a @strapi/database lifecycle Event is
  // `{ action, model, params, state }` (dist/lifecycles/types.d.ts) and carries
  // NO top-level `where`; entity-manager calls
  // `db.lifecycles.run('beforeUpdate', uid, { params })` with the whole
  // `{ where, data }` inside `params`. Destructuring `where` off the event gave
  // `undefined`, so every profile/user save that included an email was rejected
  // with "An account with this email address already exists."
  //
  // NOTE: there is no DB UNIQUE index on admin_users.email or up_users.email —
  // the "migration 002" backstop this comment used to claim does not exist
  // (server/migrations/ holds only 001). This app-layer check is the only
  // enforcement, which is why it must not be skipped when the id is unreadable.
  try {
    const emailUniqueSvc = strapi.plugin('erp-session-manager').service('emailUniqueness');

    // ── admin_users ────────────────────────────────────────────────────────────
    strapi.db.lifecycles.subscribe({
      models: ['admin::user'],

      async beforeCreate({ params }) {
        const email = params && params.data && params.data.email;
        if (email) {
          await emailUniqueSvc.enforceAdminEmailUnique(email);
        }
      },

      async beforeUpdate({ params }) {
        const email = params && params.data && params.data.email;
        if (email) {
          // params.where identifies the row(s) being updated — exclude them
          const excludeIds = emailUniqueSvc.resolveExcludeIds(params?.where);
          await emailUniqueSvc.enforceAdminEmailUnique(email, excludeIds);
        }
      },
    });

    // ── up_users (users-permissions) ───────────────────────────────────────────
    strapi.db.lifecycles.subscribe({
      models: ['plugin::users-permissions.user'],

      async beforeCreate({ params }) {
        const email = params && params.data && params.data.email;
        if (email) {
          await emailUniqueSvc.enforceUserEmailUnique(email);
        }
      },

      async beforeUpdate({ params }) {
        const email = params && params.data && params.data.email;
        if (email) {
          const excludeIds = emailUniqueSvc.resolveExcludeIds(params?.where);
          await emailUniqueSvc.enforceUserEmailUnique(email, excludeIds);
        }
      },
    });

    strapi.log.info('[erp-session-manager] Email uniqueness lifecycle hooks registered.');
  } catch (err) {
    strapi.log.error(
      `[erp-session-manager] Failed to register email uniqueness hooks: ${err.message}`
    );
  }

  // 6. Schedule daily audit log cleanup cron (Req 6.5)
  const auditLogger = strapi.plugin('erp-session-manager').service('auditLogger');
  strapi.cron.add({
    '0 0 * * *': async () => {
      await auditLogger.cleanup();
    },
  });

  // 6b. Schedule daily activity log cleanup cron (G2)
  strapi.cron.add({
    '0 1 * * *': async () => {
      try {
        const policyService = strapi.plugin('erp-session-manager').service('policy');
        const policy        = await policyService.getPolicy();
        const retentionDays = policy.activityLogRetentionDays ?? 30;
        const cutoff        = new Date(Date.now() - retentionDays * 86400000).toISOString();
        await strapi
          .documents('plugin::erp-session-manager.erp-session-activity')
          .deleteMany({ filters: { loggedAt: { $lt: cutoff } } });
      } catch (err) {
        strapi.log.warn(`[erp-session-manager] Activity log cleanup error: ${err.message}`);
      }
    },
  });

  // 7. Warn if only one signing key is configured (Req 13.6)
  const signingKeys = Array.isArray(config?.tokens?.signingKeys)
    ? config.tokens.signingKeys
    : [];

  if (signingKeys.length === 1) {
    strapi.log.warn(
      '[erp-session-manager] Only one signing key is configured (tokens.signingKeys). ' +
      'Add a second key to enable zero-downtime key rotation (Req 13.6).'
    );
  }

  // 8. Log resolved config at debug level with secrets redacted (Req 17.7)
  strapi.log.debug(
    '[erp-session-manager] Resolved config: ' +
    JSON.stringify(redactSecrets(config), null, 2)
  );

  strapi.log.info('[erp-session-manager] Plugin bootstrapped successfully.');
}

/**
 * destroy({ strapi })
 *
 * Called on Strapi shutdown. Closes the Redis connection and logs shutdown.
 *
 * @param {{ strapi: object }} param0
 */
async function destroy({ strapi }) {
  // 1. Close Redis connection (and clear reconnect timers)
  await storeModule.destroy();

  // 2. Log shutdown
  strapi.log.info('[erp-session-manager] Plugin destroyed.');
}

// ---------------------------------------------------------------------------
// Plugin export — Strapi 5 plugin format
// ---------------------------------------------------------------------------

module.exports = {
  register,
  bootstrap,
  destroy,

  contentTypes: {
    'erp-session-audit-log': {
      schema: require('./content-types/erp-session-audit-log/schema.json'),
    },
    'erp-step-up-secret': {
      schema: require('./content-types/erp-step-up-secret/schema.json'),
    },
    // Gap G3: live DB-backed session policy
    'erp-session-policy': {
      schema: require('./content-types/erp-session-policy/schema.json'),
    },
    // Gap G1: known device tracking
    'erp-known-device': {
      schema: require('./content-types/erp-known-device/schema.json'),
    },
    // VAPT #27: password history enforcement
    'erp-password-history': {
      schema: require('./content-types/erp-password-history/schema.json'),
    },
    // Gap G2: per-request activity log
    'erp-session-activity': {
      schema: require('./content-types/erp-session-activity/schema.json'),
    },
  },

  services: {
    session:                require('./services/session'),
    auditLogger:            require('./services/audit-logger'),
    anomalyDetector:        require('./services/anomaly-detector'),
    passwordValidator:      require('./services/password-validator'),
    passwordHistory:        require('./services/password-history'),
    keyRotator:             require('./services/key-rotator'),
    rateLimiter:            require('./services/rate-limiter'),
    stepUp:                 require('./services/step-up'),
    stepUpConfig:           require('./services/step-up-config'),
    adminLoginTotp:         require('./services/admin-login-totp'),
    contentLoginTotp:       require('./services/content-login-totp'),
    usersPermissionsHooks:  require('./hooks/users-permissions'),
    passwordValidationHook: require('./hooks/password-validation'),
    adminAuthHook:          require('./hooks/admin-auth'),
    // New gap services
    policy:                 require('./services/policy'),
    tokenRevocation:        require('./services/token-revocation'),
    adminAlert:             require('./services/admin-alert'),
    // VAPT #5: application-layer email uniqueness enforcement
    emailUniqueness:        require('./services/email-uniqueness'),
  },

  controllers: {
    // Admin controllers — keys must match handler prefix in routes
    sessions:               require('./controllers/admin/sessions'),
    'audit-logs':           require('./controllers/admin/audit-logs'),
    status:                 require('./controllers/admin/status'),
    config:                 require('./controllers/admin/config'),
    'step-up':              require('./controllers/admin/step-up'),
    policy:                 require('./controllers/admin/policy'),
    'activity-logs-admin':  require('./controllers/admin/activity-logs-admin'),
    permissions:            require('./controllers/admin/permissions'),
    // User (content-api) controllers
    refresh:                require('./controllers/user/refresh'),
    logout:                 require('./controllers/user/logout'),
    'my-sessions':          require('./controllers/user/my-sessions'),
    'content-login-totp':   require('./controllers/user/content-login-totp'),
    // VAPT #20 — image CAPTCHA challenge endpoint (public, no auth)
    captcha:                require('./controllers/user/captcha'),
  },

  routes: {
    admin: require('./routes/admin'),
    user:  require('./routes/user'),
  },

  middlewares: {
    hsts:                       require('./middlewares/hsts'),
    'rate-limit':               require('./middlewares/rate-limit'),
    'session-auth':             require('./middlewares/session-auth'),
    'step-up-auth':             require('./middlewares/step-up-auth'),
    'session-activity-logger':  require('./middlewares/session-activity-logger'),
    'admin-session-hardener':   require('./middlewares/admin-session-hardener'),
    'admin-api-guard':          require('./middlewares/admin-api-guard'),
  },

  policies: {
    'is-super-admin': require('./policies/is-super-admin'),
  },
};
