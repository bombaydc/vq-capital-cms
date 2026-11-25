'use strict';

/**
 * HttpsRedirect — project-root global middleware (VAPT #22).
 *
 * Issues a 301 Permanent Redirect from HTTP to HTTPS in production
 * environments, closing the VAPT #22 gap where a client's very first
 * HTTP request is not protected by HSTS (HSTS only takes effect after
 * the browser has seen the Strict-Transport-Security header at least once).
 *
 * Behaviour:
 *   • Only activates when NODE_ENV === 'production'
 *   • Can be overridden via HTTPS_REDIRECT=false env var (operator escape
 *     hatch for production setups with TLS termination that does not
 *     forward X-Forwarded-Proto)
 *   • Detects HTTP via the X-Forwarded-Proto header (set by reverse proxies)
 *     or ctx.request.secure (direct TLS connection)
 *   • Preserves the full path + query string in the redirect Location
 *   • Issues 301 (Permanent) so browsers cache the redirect
 *
 * Infrastructure note:
 *   TLS termination should still be handled at the reverse proxy / load
 *   balancer layer (nginx, Apache, AWS ALB, etc.).  This middleware
 *   provides application-layer defence-in-depth for cases where a client
 *   bypasses the proxy or the proxy misconfiguration allows HTTP through.
 *
 * References: VAPT #22, OWASP ASVS v4 §9.1
 */

/**
 * Pure helper — returns true if the Koa context represents an HTTP (not HTTPS) request.
 * Exported for unit testing (p36).
 *
 * @param {object} ctx — Koa context
 * @returns {boolean} true if the request is HTTP and should be redirected
 */
function _isHttpRequest(ctx) {
  const fwdProto = (ctx.get('X-Forwarded-Proto') || '').toLowerCase();
  // An explicit https value from the proxy → already secure
  if (fwdProto === 'https') return false;
  // Direct TLS connection (no proxy)
  if (ctx.request.secure) return false;
  // Either explicit 'http' from proxy, or no proxy header and connection is plaintext
  return true;
}

// ─── Middleware factory ───────────────────────────────────────────────────────

const factory = (config, { strapi }) => {
  return async (ctx, next) => {
    // Only enforce in production (avoids breaking local HTTP development)
    if (process.env.NODE_ENV !== 'production') {
      await next();
      return;
    }

    // Operator override: HTTPS_REDIRECT=false disables the redirect
    // (useful when the production reverse proxy terminates TLS without
    // forwarding X-Forwarded-Proto and the operator manages redirects elsewhere)
    if (process.env.HTTPS_REDIRECT === 'false') {
      await next();
      return;
    }

    // If the request arrived over HTTP, redirect permanently to HTTPS
    if (_isHttpRequest(ctx)) {
      const httpsUrl = `https://${ctx.hostname}${ctx.url}`;
      strapi.log.debug(
        `[https-redirect] 301 redirect: ${ctx.method} ${ctx.url} → ${httpsUrl}`
      );
      ctx.status = 301;
      ctx.set('Location', httpsUrl);
      ctx.body = ''; // Keep body empty — 301 responses should not have a body
      return; // Do NOT call next() — request is handled
    }

    // Already HTTPS — pass through
    await next();
  };
};

module.exports = factory;
module.exports._isHttpRequest = _isHttpRequest;
