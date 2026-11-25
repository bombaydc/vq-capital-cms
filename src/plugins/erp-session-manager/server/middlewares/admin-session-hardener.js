'use strict';

/**
 * AdminSessionHardener_Middleware — HttpOnly cookie management for the Strapi
 * admin panel (Gap G8).
 *
 * Inbound:
 *   If `strapi_admin_token` cookie present and Authorization header absent,
 *   synthesize `Authorization: Bearer <cookie>` so downstream middleware works normally.
 *
 * After next() — login (POST /admin/login) and native access-token renewal
 * (POST /admin/access-token), 2xx:
 *   Extract the access token from the response body → set HttpOnly
 *   SameSite=Strict Secure cookie, keeping the cookie current with rotation.
 *
 * After next() — logout (POST /admin/logout):
 *   Clear the cookie (maxAge=0).
 *
 * Token rotation itself is native in Strapi ≥5.13: access tokens are
 * short-lived and the panel renews them via POST /admin/access-token
 * (refresh-token rotation in the session manager). The rotation interval is
 * driven by Settings → Policy `tokenRotationMinutes`, which the Policy service
 * maps to `accessTokenLifespan` via sessionManager.defineOrigin('admin', …).
 * The old time-based re-issuance this middleware performed used
 * `admin::token.createJwtToken`, which was removed from Strapi core.
 *
 * References: Gap G8
 */

const COOKIE_NAME = 'strapi_admin_token';
const COOKIE_OPTIONS_BASE = {
  httpOnly:  true,
  sameSite:  'strict',
  path:      '/',
  overwrite: true,
};

function isSecure(ctx) {
  return (process.env.NODE_ENV === 'production') ||
    ctx.request.secure ||
    (ctx.get('X-Forwarded-Proto') || '').toLowerCase() === 'https';
}

module.exports = (config, { strapi }) => {
  return async (ctx, next) => {
    const method = (ctx.method || '').toUpperCase();
    const path   = ctx.path || '';

    // ── Inbound: synthesize Authorization header from cookie ──────────────────
    const cookieToken = ctx.cookies.get(COOKIE_NAME);
    if (cookieToken && !ctx.get('Authorization') && !ctx.get('authorization')) {
      ctx.set('Authorization', `Bearer ${cookieToken}`);
    }

    await next();

    // ── After next() — capture token on login + native access-token renewal ───
    const isTokenIssuingPath = path === '/admin/login' || path === '/admin/access-token';
    if (method === 'POST' && isTokenIssuingPath && ctx.status >= 200 && ctx.status < 300) {
      try {
        const body = ctx.body;
        const token =
          (body && body.data && body.data.token) ||
          (body && body.token);

        if (token) {
          const opts = {
            ...COOKIE_OPTIONS_BASE,
            secure: isSecure(ctx),
          };
          ctx.cookies.set(COOKIE_NAME, token, opts);
        }
      } catch (err) {
        strapi.log.warn(`[erp-session-manager] Admin cookie set error: ${err.message}`);
      }
      return;
    }

    // ── After next() — handle logout ──────────────────────────────────────────
    if (method === 'POST' && path === '/admin/logout') {
      ctx.cookies.set(COOKIE_NAME, '', { ...COOKIE_OPTIONS_BASE, maxAge: 0, secure: isSecure(ctx) });
    }
  };
};
