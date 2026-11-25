'use strict';

/**
 * PolicyService — runtime session policy, backed by erp-session-policy singleType.
 *
 * Wraps the DB-editable policy record with a 5-minute in-memory cache so every
 * request does not hit the database.  Falls back gracefully to static plugin
 * config when no DB record exists yet (first boot) or on DB errors.
 *
 * All services that previously read session limits from
 * strapi.config.get('plugin::erp-session-manager') now call getPolicy() instead,
 * which makes every value live-editable from the admin Settings → Policy tab
 * without a server restart.
 *
 * References: Gap G3, G4 — DB-editable runtime session policy
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Push the panel-edited idle timeout into Strapi's NATIVE admin session manager
 * so the admin panel ("CMS portal") honours the live Policy WITHOUT a restart.
 *
 * Why this is needed:
 *   Admin-panel logout is governed by Strapi's native session store, whose idle
 *   lifespans are captured once at boot via
 *   `strapi.sessionManager.defineOrigin('admin', {...})`
 *   (see @strapi/admin server bootstrap). That config is boot-time only — the
 *   plugin's own idle timeout (and the Settings → Policy field) does NOT reach it,
 *   which is why raising the policy alone left the panel logging out at the old
 *   value.
 *
 * Why re-calling defineOrigin() works live:
 *   `defineOrigin(origin, config)` simply stores `config` in a Map, and the
 *   session manager reads `idleRefreshTokenLifespan` / `idleSessionLifespan` from
 *   that Map *per token operation* (generate / validate / refresh). Re-defining
 *   the 'admin' origin therefore takes effect on the very next request — no
 *   restart required.
 *
 * The access-token lifespan is driven by the Policy's `tokenRotationMinutes`:
 * Strapi ≥5.13 rotates admin access tokens natively (the panel renews them via
 * POST /admin/access-token with refresh-token rotation), so the rotation
 * interval IS the access-token lifespan. The legacy re-issuance API
 * (`admin::token.createJwtToken`) was removed from core, making this the
 * supported rotation mechanism.
 *
 * All other fields are reconstructed exactly as the admin bootstrap set them
 * (admin.auth.* + admin token options) so JWT signing, algorithm, and the hard
 * max-lifespan caps are unchanged.
 *
 * Non-fatal: any failure is logged and swallowed so a policy save never breaks.
 *
 * @param {object} strapi
 * @param {object} policy — effective policy (uses idleTimeoutMinutes, tokenRotationMinutes)
 */
function _syncAdminSessionLifespans(strapi, policy) {
  try {
    const sm = strapi.sessionManager;
    if (!sm || typeof sm.defineOrigin !== 'function' || !sm.hasOrigin('admin')) {
      // Native admin session manager not available yet (origin defined later in
      // boot) or running on an older Strapi. The config/admin.js values remain
      // in effect as the boot default until the next sync.
      return false;
    }

    const idleSeconds = Math.max(60, Math.round((policy.idleTimeoutMinutes ?? 15) * 60));

    // Access-token lifespan = rotation interval, clamped to [60 s, 30 min].
    // The 30-min ceiling is the OWASP ASVS 3.7 bound for admin access tokens
    // (VAPT #7) — the same bound p22-jwt-lifetime enforces on the boot config;
    // a panel-edited policy must not be able to exceed it. Non-finite values
    // (corrupt record) fall back to the 15-min default.
    const OWASP_MAX_ACCESS_TOKEN_SECONDS = 30 * 60;
    const rotMinutes = Number.isFinite(policy.tokenRotationMinutes) ? policy.tokenRotationMinutes : 15;
    const rotationSeconds = Math.min(
      OWASP_MAX_ACCESS_TOKEN_SECONDS,
      Math.max(60, Math.round(rotMinutes * 60))
    );

    // Preserve algorithm + jwtOptions exactly as @strapi/admin bootstrap did.
    let tokenOptions = {};
    try {
      const adminTokenSvc = strapi.service('admin::token');
      if (adminTokenSvc && typeof adminTokenSvc.getTokenOptions === 'function') {
        tokenOptions = adminTokenSvc.getTokenOptions().options || {};
      }
    } catch { /* fall back to empty options */ }

    const cfg = (key, dflt) => strapi.config.get(`admin.auth.sessions.${key}`, dflt);

    sm.defineOrigin('admin', {
      jwtSecret:                strapi.config.get('admin.auth.secret'),
      accessTokenLifespan:      rotationSeconds, // ← driven by Settings → Policy (token rotation)
      maxRefreshTokenLifespan:  cfg('maxRefreshTokenLifespan', 8 * 60 * 60),
      idleRefreshTokenLifespan: idleSeconds, // ← driven by Settings → Policy
      maxSessionLifespan:       cfg('maxSessionLifespan', 8 * 60 * 60),
      idleSessionLifespan:      idleSeconds, // ← driven by Settings → Policy
      algorithm:                tokenOptions.algorithm,
      jwtOptions:               tokenOptions,
    });

    strapi.log.info(
      `[erp-session-manager] Admin panel session lifespans synced live from policy: ` +
      `idle ${idleSeconds}s (${policy.idleTimeoutMinutes} min), ` +
      `access-token rotation ${rotationSeconds}s (${policy.tokenRotationMinutes} min).`
    );
    return true;
  } catch (err) {
    strapi.log.warn(`[erp-session-manager] Admin session lifespan sync failed: ${err.message}`);
    return false;
  }
}

module.exports = ({ strapi }) => {
  /** @type {{ data: object, fetchedAt: number }|null} */
  let _cache = null;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * Build a policy object from the static plugin config (used as fallback /
   * baseline when no DB record exists).
   */
  function _buildFromConfig() {
    const c = strapi.config.get('plugin::erp-session-manager') || {};
    const s = c.sessions || {};
    const su = c.stepUp   || {};
    const al = c.auditLog || {};
    const an = s.anomaly  || {};

    return {
      // Session behaviour
      maxConcurrentSessions:    s.maxConcurrent   ?? 2,
      idleTimeoutMinutes:       Math.round((s.idleTimeout     ?? 900) / 60),
      absoluteTimeoutHours:     Math.round((s.absoluteTimeout ?? 14400) / 3600),
      tokenRotationMinutes:     15,
      // Step-up
      stepUpRequiredRoutes:     su.protectedRoutes ?? ['policy_management', 'password_change'],
      stepUpValidityMinutes:    Math.round((su.tokenTtl ?? 300) / 60),
      // Alerts
      alertNewDevice:           true,
      alertAnomaly:             true,
      alertAfterFailedAttempts: 3,
      // Business hours (UTC+5:30 IST)
      businessHoursStart:       9,
      businessHoursEnd:         18,
      // Activity logging
      activityLoggingEnabled:   true,
      activityLogRetentionDays: 30,
      // Retention
      sessionRetentionDays:     al.retentionDays ?? 180,
      // Anomaly detection
      blockOnIpChange:          an.blockOnIpChange         ?? true,
      blockOnUaChange:          an.blockOnUaChange         ?? false,
      impossibleTravelEnabled:  an.impossibleTravelEnabled ?? false,
      maxSpeedKmh:              an.maxSpeedKmh             ?? 900,
      updatedByAdminId:         null,
    };
  }

  /**
   * Merge a DB record with config-derived defaults, preferring DB values for
   * any field that is not null/undefined in the record.
   */
  function _merge(record) {
    const base = _buildFromConfig();
    if (!record) return base;

    return {
      maxConcurrentSessions:    record.maxConcurrentSessions    ?? base.maxConcurrentSessions,
      idleTimeoutMinutes:       record.idleTimeoutMinutes       ?? base.idleTimeoutMinutes,
      absoluteTimeoutHours:     record.absoluteTimeoutHours     ?? base.absoluteTimeoutHours,
      tokenRotationMinutes:     record.tokenRotationMinutes     ?? base.tokenRotationMinutes,
      stepUpRequiredRoutes:     record.stepUpRequiredRoutes     ?? base.stepUpRequiredRoutes,
      stepUpValidityMinutes:    record.stepUpValidityMinutes    ?? base.stepUpValidityMinutes,
      alertNewDevice:           record.alertNewDevice           ?? base.alertNewDevice,
      alertAnomaly:             record.alertAnomaly             ?? base.alertAnomaly,
      alertAfterFailedAttempts: record.alertAfterFailedAttempts ?? base.alertAfterFailedAttempts,
      businessHoursStart:       record.businessHoursStart       ?? base.businessHoursStart,
      businessHoursEnd:         record.businessHoursEnd         ?? base.businessHoursEnd,
      activityLoggingEnabled:   record.activityLoggingEnabled   ?? base.activityLoggingEnabled,
      activityLogRetentionDays: record.activityLogRetentionDays ?? base.activityLogRetentionDays,
      sessionRetentionDays:     record.sessionRetentionDays     ?? base.sessionRetentionDays,
      blockOnIpChange:          record.blockOnIpChange          ?? base.blockOnIpChange,
      blockOnUaChange:          record.blockOnUaChange          ?? base.blockOnUaChange,
      impossibleTravelEnabled:  record.impossibleTravelEnabled  ?? base.impossibleTravelEnabled,
      maxSpeedKmh:              record.maxSpeedKmh              ?? base.maxSpeedKmh,
      updatedByAdminId:         record.updatedByAdminId         ?? null,
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  return {
    /**
     * getPolicy()
     *
     * Returns the effective session policy.  Reads from the DB (via the Strapi
     * Documents API on erp-session-policy) and caches for CACHE_TTL_MS.
     * Falls back to config defaults on any DB error.
     *
     * @returns {Promise<object>} the policy object
     */
    async getPolicy() {
      const now = Date.now();
      if (_cache && now - _cache.fetchedAt < CACHE_TTL_MS) {
        return _cache.data;
      }

      try {
        const record = await strapi
          .documents('plugin::erp-session-manager.erp-session-policy')
          .findFirst({});

        const merged = _merge(record);
        _cache = { data: merged, fetchedAt: now };
        return merged;
      } catch (err) {
        strapi.log.warn(
          `[policy] DB read failed, using config defaults: ${err.message}`
        );
        return _buildFromConfig();
      }
    },

    /**
     * updatePolicy(fields, adminId)
     *
     * Upserts the erp-session-policy singleType record, invalidates the cache.
     *
     * @param {object} fields   — partial policy fields to write
     * @param {number} adminId  — ID of the admin making the change
     * @returns {Promise<void>}
     */
    async updatePolicy(fields, adminId) {
      const data = { ...fields, updatedByAdminId: adminId || null };

      try {
        const existing = await strapi
          .documents('plugin::erp-session-manager.erp-session-policy')
          .findFirst({});

        if (existing) {
          await strapi
            .documents('plugin::erp-session-manager.erp-session-policy')
            .update({ documentId: existing.documentId, data });
        } else {
          await strapi
            .documents('plugin::erp-session-manager.erp-session-policy')
            .create({ data });
        }
      } catch (err) {
        strapi.log.error(`[policy] updatePolicy failed: ${err.message}`);
        throw err;
      }

      // Invalidate cache so the next getPolicy() reads fresh data
      _cache = null;

      // Push the new idle timeout into Strapi's native admin session manager so
      // the admin panel honours the panel edit live (no restart). Non-fatal.
      try {
        const merged = await this.getPolicy();
        _syncAdminSessionLifespans(strapi, merged);
      } catch (err) {
        strapi.log.warn(`[policy] admin session sync after update failed: ${err.message}`);
      }
    },

    /**
     * syncAdminSession()
     * Applies the current effective idle timeout to Strapi's native admin session
     * manager. Called at bootstrap so a previously-saved policy survives restarts,
     * and after every policy update. Returns true if the sync was applied.
     *
     * @returns {Promise<boolean>}
     */
    async syncAdminSession() {
      const policy = await this.getPolicy();
      return _syncAdminSessionLifespans(strapi, policy);
    },

    /**
     * invalidateCache()
     * Forcibly clears the in-memory cache (e.g. after an update elsewhere).
     */
    invalidateCache() {
      _cache = null;
    },
  };
};
