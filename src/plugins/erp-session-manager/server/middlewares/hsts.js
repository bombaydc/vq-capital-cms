'use strict';

/**
 * HSTS_Middleware — sets the Strict-Transport-Security header on every response.
 *
 * Reads configuration from the erp-session-manager plugin config `hsts` section.
 * When `hsts.enabled` is false the header is omitted entirely (Req 9.5).
 *
 * References: Req 9.1–9.5, Design §2.2
 */

module.exports = (config, { strapi }) => {
  return async (ctx, next) => {
    await next();

    const pluginConfig = strapi.config.get('plugin::erp-session-manager');
    const hsts = (pluginConfig && pluginConfig.hsts) ? pluginConfig.hsts : {};

    // Req 9.5 — skip header when disabled (e.g. local development)
    if (hsts.enabled === false) {
      return;
    }

    const maxAge = typeof hsts.maxAge === 'number' ? hsts.maxAge : 31536000;
    let headerValue = `max-age=${maxAge}`;

    if (hsts.includeSubDomains !== false) {
      headerValue += '; includeSubDomains';
    }

    if (hsts.preload === true) {
      headerValue += '; preload';
    }

    ctx.set('Strict-Transport-Security', headerValue);
  };
};
