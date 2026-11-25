'use strict';

/**
 * global::login-nonce — VAPT #6: Login Bypass via Response Manipulation
 *
 * Binds each login response to the specific request that produced it by
 * echoing the client-supplied X-Login-Nonce header back in 2xx responses.
 *
 * Attack: an attacker captures a valid login success response (containing
 * a real JWT) and injects it at the point where another victim's login
 * attempt receives its response. Without binding, the frontend cannot tell
 * "my response" from "replayed response" and will store the attacker-chosen
 * JWT.
 *
 * Defence: the admin-panel fetch interceptor (src/admin/app.js) generates a
 * UUID nonce per login attempt, sends it as X-Login-Nonce, then verifies the
 * server echoes the same value before processing the response. A replayed
 * response carries the wrong nonce → interceptor returns a synthetic 401.
 *
 * Design decisions:
 *   • Applies only to POST on LOGIN_PATHS — no overhead on other routes.
 *   • Nonce is captured BEFORE next() — binds it to this request exclusively.
 *   • Echoed ONLY on 2xx — error responses carry no nonce so an attacker
 *     cannot extract a live nonce from a deliberately-triggered failure.
 *   • Missing / empty nonce: middleware passes through silently. Legacy or
 *     non-browser clients without nonce support are not broken. Enforcement
 *     is in the frontend interceptor, not the server.
 *   • Nonce truncated to MAX_NONCE_LENGTH to prevent header-size abuse.
 *   • Vary: X-Login-Nonce added on 2xx so CDN/proxy caches do not serve one
 *     user's login response to a different user's request.
 */

/** Paths on which nonce binding is active. */
const LOGIN_PATHS = new Set([
  '/admin/auth/local',  // Strapi admin login (users-permissions admin controller)
  '/api/auth/local',    // Content-API / users-permissions user login
]);

const NONCE_HEADER     = 'X-Login-Nonce';
const MAX_NONCE_LENGTH = 128;  // UUID v4 is 36 chars; 128 is a safe upper bound

// ---------------------------------------------------------------------------

module.exports = (config, { strapi }) => {
  return async function loginNonce(ctx, next) {
    // Only intercept POST requests on the defined login paths
    if (ctx.method !== 'POST' || !LOGIN_PATHS.has(ctx.path)) {
      return next();
    }

    // Capture the nonce BEFORE calling next() — this binds the nonce value
    // to this specific inbound request and its position in the Koa stack.
    const rawNonce = ctx.get(NONCE_HEADER);
    const nonce    =
      typeof rawNonce === 'string' && rawNonce.length > 0
        ? rawNonce.slice(0, MAX_NONCE_LENGTH)
        : null;

    await next();

    // Echo the nonce only on 2xx success responses.
    // 4xx/5xx responses must NOT carry a nonce: if they did, an attacker who
    // could deliberately trigger a failure response would learn the live nonce
    // and could stamp a separately-captured success response with it.
    if (nonce && ctx.status >= 200 && ctx.status < 300) {
      ctx.set(NONCE_HEADER, nonce);
      // Vary tells downstream caches that this response is specific to this
      // nonce value — do not serve it to requests with a different nonce.
      ctx.vary(NONCE_HEADER);
    }
  };
};

// Exported for unit testing — pure constants, no side effects
module.exports.LOGIN_PATHS      = LOGIN_PATHS;
module.exports.NONCE_HEADER     = NONCE_HEADER;
module.exports.MAX_NONCE_LENGTH = MAX_NONCE_LENGTH;
