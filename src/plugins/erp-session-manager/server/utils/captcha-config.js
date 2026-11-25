'use strict';

/**
 * CAPTCHA runtime config — persistence via strapi.store (admin panel managed).
 *
 * Config saved via the admin panel is persisted to strapi_core_store_settings
 * and takes priority over the static defaults in config/plugins.js.
 * No server restart is needed to enable/disable CAPTCHA or adjust TTL.
 *
 * VAPT #20 — Missing CAPTCHA (Low, CVSS 2.6).
 */

const { verifyCaptchaAnswer } = require('./captcha');

const STORE_KEY = 'captcha';

/**
 * Read the current CAPTCHA config.
 * Priority: strapi.store (admin-panel-saved) → plugin config defaults.
 *
 * @param {object} strapi
 * @returns {Promise<{ enabled: boolean, enforceForContentApi: boolean, ttlSeconds: number }>}
 */
async function getCaptchaConfig(strapi) {
  try {
    const stored = await strapi
      .store({ type: 'plugin', name: 'erp-session-manager' })
      .get({ key: STORE_KEY });
    if (stored && typeof stored === 'object') return stored;
  } catch (err) {
    strapi.log.warn(
      `[erp-session-manager] Could not read captcha store config: ${err.message}`
    );
  }
  // Fallback: static defaults from config/plugins.js
  const pluginConfig = strapi.config.get('plugin::erp-session-manager') || {};
  return pluginConfig.captcha || {
    enabled: false, enforceForContentApi: true, enforceForAdminPanel: true, ttlSeconds: 300,
  };
}

/**
 * Persist CAPTCHA config via strapi.store.
 *
 * @param {object} strapi
 * @param {{ enabled: boolean, enforceForContentApi: boolean, ttlSeconds: number }} value
 */
async function saveCaptchaConfig(strapi, value) {
  await strapi
    .store({ type: 'plugin', name: 'erp-session-manager' })
    .set({ key: STORE_KEY, value });
}

/**
 * Verify the CAPTCHA on an inbound Koa ctx.
 * Used by all three auth hooks (login, register, forgot-password).
 *
 * Returns true  — request should proceed (CAPTCHA disabled, or exempt, or passed).
 * Returns false — CAPTCHA required but token is absent/wrong/expired.
 *
 * @param {object} ctx     Koa context
 * @param {object} strapi
 * @returns {Promise<boolean>}
 */
async function checkCaptcha(ctx, strapi) {
  const cfg = await getCaptchaConfig(strapi);
  if (!cfg.enabled) return true;                       // globally disabled — always allow
  if (cfg.enforceForContentApi === false) return true; // content-API explicitly exempt

  const secret = (strapi.config.get('server.app.keys') || [])[0] || 'captcha-fallback-secret';
  const token  = ctx.request.body && ctx.request.body.captchaToken;
  const answer = ctx.request.body && ctx.request.body.captchaAnswer;
  return verifyCaptchaAnswer(secret, token, answer);
}

/**
 * Verify the CAPTCHA on an inbound admin-panel auth request.
 * Reads enforceForAdminPanel (not enforceForContentApi).
 *
 * Returns true  — request should proceed.
 * Returns false — CAPTCHA required but token is absent/wrong/expired.
 *
 * @param {object} ctx     Koa context
 * @param {object} strapi
 * @returns {Promise<boolean>}
 */
async function checkAdminCaptcha(ctx, strapi) {
  const cfg = await getCaptchaConfig(strapi);
  if (!cfg.enabled) return true;                        // globally disabled — always allow
  if (cfg.enforceForAdminPanel === false) return true;  // admin panel explicitly exempt

  const secret = (strapi.config.get('server.app.keys') || [])[0] || 'captcha-fallback-secret';
  const token  = ctx.request.body && ctx.request.body.captchaToken;
  const answer = ctx.request.body && ctx.request.body.captchaAnswer;
  return verifyCaptchaAnswer(secret, token, answer);
}

module.exports = { getCaptchaConfig, saveCaptchaConfig, checkCaptcha, checkAdminCaptcha };
