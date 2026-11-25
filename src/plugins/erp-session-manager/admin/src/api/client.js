/**
 * Plugin API client — hook-based wrapper for all erp-session-manager endpoints.
 *
 * Uses `useFetchClient` from `@strapi/strapi/admin` (Strapi 5) so that the
 * admin JWT is automatically attached to every request.
 *
 * Design §3 (admin/src/api/client.js)
 */

import { useFetchClient } from '@strapi/strapi/admin';

const PLUGIN_BASE = '/erp-session-manager';

/**
 * Returns an object of typed API helpers backed by the Strapi 5 fetch client.
 * Must be called inside a React component or hook (rules of hooks apply).
 */
export function useApiClient() {
  const { get, post, del, put } = useFetchClient();


  return {
    // ── Sessions ────────────────────────────────────────────────────────────
    getSessions: (params) =>
      get(`${PLUGIN_BASE}/sessions`, { params }),

    getSession: (sessionId) =>
      get(`${PLUGIN_BASE}/sessions/${sessionId}`),

    revokeSession: (sessionId) =>
      del(`${PLUGIN_BASE}/sessions/${sessionId}`),

    revokeSessionsByUser: (userId) =>
      del(`${PLUGIN_BASE}/sessions/user/${userId}`),

    revokeSessionsBulk: (sessionIds) =>
      post(`${PLUGIN_BASE}/sessions/bulk`, { sessionIds }),

    // ── Audit Logs ──────────────────────────────────────────────────────────
    getAuditLogs: (params) =>
      get(`${PLUGIN_BASE}/audit-logs`, { params }),

    exportAuditLogs: (params) =>
      get(`${PLUGIN_BASE}/audit-logs/export`, { params }),

    // ── Status & Config ─────────────────────────────────────────────────────
    getStatus: () =>
      get(`${PLUGIN_BASE}/status`),

    getConfig: () =>
      get(`${PLUGIN_BASE}/config`),

    testRedis: () =>
      post(`${PLUGIN_BASE}/store/test-redis`),

    // ── Step-Up Authentication ───────────────────────────────────────────────
    getStepUpGlobalConfig: () =>
      get(`${PLUGIN_BASE}/step-up/global-config`),

    setStepUpEnabled: (enabled) =>
      post(`${PLUGIN_BASE}/step-up/global-config`, { enabled }),

    getStepUpStatus: () =>
      get(`${PLUGIN_BASE}/step-up/status`),

    getStepUpSetup: () =>
      get(`${PLUGIN_BASE}/step-up/setup`),

    verifyStepUpSetup: (totpCode) =>
      post(`${PLUGIN_BASE}/step-up/setup/verify`, { totpCode }),

    removeStepUpSecret: () =>
      post(`${PLUGIN_BASE}/step-up/remove`, {}),

    regenerateStepUp: (totpCode) =>
      post(`${PLUGIN_BASE}/step-up/regenerate`, { totpCode }),

    challengeStepUp: (totpCode) =>
      post(`${PLUGIN_BASE}/step-up/challenge`, { totpCode }),

    // ── Live Security Policy (G4) ────────────────────────────────────────────
    getPolicy: () =>
      get(`${PLUGIN_BASE}/policy`),

    updatePolicy: (data, stepUpToken) =>
      put(`${PLUGIN_BASE}/policy`, data,
        stepUpToken ? { headers: { 'X-Step-Up-Token': stepUpToken } } : undefined
      ),

    // ── Activity Logs (G19) ──────────────────────────────────────────────────
    getActivityLogs: (params) =>
      get(`${PLUGIN_BASE}/activity-logs`, { params }),

    getSessionActivity: (sessionId, params) =>
      get(`${PLUGIN_BASE}/activity-logs/session/${sessionId}`, { params }),

    // ── Permissions (G16/G17) ────────────────────────────────────────────────
    getPermissions: () =>
      get(`${PLUGIN_BASE}/permissions`),

    // ── CAPTCHA config (VAPT #20) ────────────────────────────────────────────
    getCaptchaConfig: () =>
      get(`${PLUGIN_BASE}/config/captcha`),

    updateCaptchaConfig: (data) =>
      put(`${PLUGIN_BASE}/config/captcha`, data),
  };
}
