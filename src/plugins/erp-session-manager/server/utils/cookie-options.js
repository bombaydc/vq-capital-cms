'use strict';

/**
 * Build the standard erp_rt cookie options from plugin config.
 *
 * @param {object} pluginConfig  — resolved plugin config
 * @param {number} maxAgeMs      — cookie max-age in milliseconds (0 to clear)
 * @returns {object}             — Koa cookie options
 */
function buildCookieOptions(pluginConfig, maxAgeMs) {
  const cookies = (pluginConfig && pluginConfig.cookies) || {};

  return {
    httpOnly: cookies.httpOnly !== false,                    // default true
    secure:   cookies.secure   !== undefined
                ? Boolean(cookies.secure)
                : process.env.NODE_ENV === 'production',    // fallback
    sameSite: (cookies.sameSite || 'Strict').toLowerCase(), // always 'strict'
    maxAge:   maxAgeMs,
    path:     '/',
    ...(cookies.domain ? { domain: cookies.domain } : {}),
  };
}

module.exports = { buildCookieOptions };
