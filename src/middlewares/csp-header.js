'use strict';

/**
 * Security Headers Middleware — VAPT #21 (Missing Security Headers / XSS Protection)
 *
 * Runs in the after-next() phase so it executes AFTER all downstream middleware
 * (including koa-static / strapi::public) has finished setting response headers.
 * Positioned after strapi::security (Helmet) in the Koa onion but running in the
 * return direction, meaning our after-next() runs AFTER Helmet's before-next() and
 * can override any Helmet defaults we want to strengthen.
 *
 * Responsibilities:
 *   1. Content-Security-Policy  — blocks inline script execution, restricts
 *                                  resource origins, prevents clickjacking
 *   2. X-Content-Type-Options   — prevents MIME sniffing that enables script exec
 *   3. Referrer-Policy          — limits referrer leakage on cross-origin navigation
 *   4. Permissions-Policy       — denies browser APIs unused by the CMS admin
 *
 * References: VAPT #21; OWASP Secure Headers Project; CWE-116; CWE-693;
 *             OWASP CSP Cheat Sheet; MDN Permissions-Policy
 */

// ── S3 / CDN origin helper ────────────────────────────────────────────────────

/**
 * Build the list of trusted S3 / CDN origins from env vars.
 * Mirrors the same logic in config/middlewares.js (Helmet img-src / media-src)
 * so that both CSP layers stay consistent when AWS_BUCKET / AWS_CDN_URL are set.
 *
 * Called once at module load — env vars are stable after startup.
 */
function buildTrustedMediaOrigins() {
  const origins = [];
  const bucket = process.env.AWS_BUCKET;
  const region = process.env.AWS_REGION || 'us-east-1';

  if (bucket) {
    // Virtual-hosted-style: bucket.s3.region.amazonaws.com
    origins.push(`${bucket}.s3.${region}.amazonaws.com`);
    // Path-style fallback (Cloudflare R2, MinIO, etc.)
    origins.push(`s3.${region}.amazonaws.com`);
  }

  const cdnUrl = process.env.AWS_CDN_URL;
  if (cdnUrl) {
    try {
      origins.push(new URL(cdnUrl).host);
    } catch {
      // Invalid URL — skip silently
    }
  }

  return origins;
}

const TRUSTED_MEDIA_ORIGINS = buildTrustedMediaOrigins();

// ── CSP directives ─────────────────────────────────────────────────────────────

/**
 * Base CSP directives applied to every response.
 *
 * Notes on specific choices:
 *   script-src 'self'          — allows same-origin scripts only; 'nonce-...' would
 *                                 be ideal but requires patching the Strapi admin build
 *   style-src  'unsafe-inline' — required by Strapi's admin panel (React-in-JS styles)
 *   base-uri   'self'          — VAPT #21: prevents <base href="attacker.com">
 *                                 hijacking, which would rebase all relative URLs
 *   form-action 'self'         — VAPT #21: restricts form submissions to same origin;
 *                                 blocks cross-origin form-hijacking attacks
 *   frame-ancestors 'none'     — stronger than X-Frame-Options: DENY
 *   object-src  'none'         — blocks Flash, Java applets, and plugin content
 */
const BASE_DIRECTIVES = {
  'default-src':     ["'self'"],
  'script-src':      ["'self'"],
  'style-src':       ["'self'", "'unsafe-inline'"],
  'img-src':         ["'self'", 'data:', 'blob:', ...TRUSTED_MEDIA_ORIGINS],
  'media-src':       ["'self'", 'data:', 'blob:', ...TRUSTED_MEDIA_ORIGINS],
  'font-src':        ["'self'"],
  'connect-src':     ["'self'", 'https:'],
  'frame-ancestors': ["'none'"],
  'object-src':      ["'none'"],
  'base-uri':        ["'self'"],   // VAPT #21: prevent <base> tag hijacking
  'form-action':     ["'self'"],   // VAPT #21: restrict form submission targets
};

/**
 * CKEditor 5 CDN origin — required by @ckeditor/strapi-plugin-ckeditor (v1.x).
 * The plugin loads the editor bundle + CSS from cdn.ckeditor.com at runtime and
 * sends anonymous usage pings to proxy-event.ckeditor.com. These origins are
 * added to ADMIN_EXTRA only, so the public-facing CSP (BASE_DIRECTIVES) stays
 * locked down — CKEditor never runs outside /admin.
 *
 * Per the official plugin docs: script-src cdn.ckeditor.com + connect-src
 * proxy-event.ckeditor.com. We additionally allow cdn.ckeditor.com on style-src,
 * font-src and img-src because the CDN serves the editor's stylesheet, icon font
 * and inline UI assets. connect-src already permits all https: in BASE, so the
 * proxy origin is covered there too, but we list it explicitly for clarity.
 */
const CKEDITOR_CDN   = 'https://cdn.ckeditor.com';
const CKEDITOR_PROXY = 'https://proxy-event.ckeditor.com';

/**
 * Additional CSP values injected for /admin paths.
 *
 * 'unsafe-eval' (script-src) is required by the Strapi admin panel's React build
 * toolchain in non-production only; in production the admin panel is pre-built so
 * eval is neither needed nor allowed.
 *
 * CKEditor CDN origins are added in BOTH dev and production because the editor is
 * loaded from the CDN at runtime regardless of NODE_ENV.
 */
const ADMIN_EXTRA = {
  'script-src': [
    CKEDITOR_CDN,
    ...(process.env.NODE_ENV !== 'production' ? ["'unsafe-eval'"] : []),
  ],
  // CKEditor 5 loads its stylesheet + UI icon font from the CDN
  'style-src':  [CKEDITOR_CDN],
  'font-src':   [CKEDITOR_CDN],
  // Strapi admin marketplace assets + CKEditor CDN images
  'img-src':    ['market-assets.strapi.io', CKEDITOR_CDN],
  // CKEditor usage-telemetry proxy (already covered by BASE 'https:' but explicit)
  'connect-src': [CKEDITOR_PROXY],
};

/**
 * Build a CSP header string from a directives map.
 * @param {Record<string, string[]>} directives
 * @returns {string}
 */
function buildCspHeader(directives) {
  return Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(' ')}`)
    .join('; ');
}

// ── Additional browser security headers (VAPT #21) ────────────────────────────

/**
 * Companion security headers set on every response alongside the CSP.
 *
 * X-Content-Type-Options: nosniff
 *   Belt-and-suspenders: Helmet (strapi::security) already sets this globally,
 *   but we reinforce here so the header is present even if Helmet config changes,
 *   and to ensure the upload-security middleware isn't the only path that sets it.
 *
 * Referrer-Policy: strict-origin-when-cross-origin
 *   OWASP-recommended value and Chrome browser default. Overrides Helmet's
 *   stricter default of 'no-referrer' which breaks analytics and some OAuth flows.
 *   Behaviour:
 *     same-origin     → full URL sent as Referer
 *     cross-origin HTTPS→HTTPS → only the origin (no path) sent
 *     cross-origin HTTPS→HTTP  → no Referer header sent (downgrade protection)
 *
 * Permissions-Policy
 *   Restricts browser APIs that the CMS admin interface has no business accessing.
 *   An empty allowlist (feature=()) means the feature is blocked for all origins
 *   including the page's own origin. Covers the highest-risk APIs:
 *     camera, microphone   — audio/video capture
 *     display-capture      — screen sharing
 *     geolocation          — physical location
 *     gyroscope/magnetometer — orientation (device fingerprinting)
 *     payment              — Web Payments API
 *     usb                  — WebUSB (physical device access)
 */
const PERMISSIONS_POLICY_VALUE = [
  'camera=()',
  'display-capture=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'payment=()',
  'usb=()',
].join(', ');

const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy':        'strict-origin-when-cross-origin',
  'Permissions-Policy':     PERMISSIONS_POLICY_VALUE,
});

// ── Middleware factory ─────────────────────────────────────────────────────────

module.exports = (config, { strapi }) => {
  return async (ctx, next) => {
    await next();

    // 1. Content-Security-Policy — build from directives, apply config overrides.
    //    Wrapped in try/catch so a CSP build failure never blocks the response.
    try {
      // Start with base directives (deep copy)
      const directives = {};
      for (const [key, values] of Object.entries(BASE_DIRECTIVES)) {
        directives[key] = [...values];
      }

      // Merge admin-specific extras for /admin paths
      if (ctx.path && ctx.path.startsWith('/admin')) {
        for (const [key, extra] of Object.entries(ADMIN_EXTRA)) {
          if (extra.length > 0) {
            directives[key] = [...(directives[key] || []), ...extra];
          }
        }
      }

      // Apply config overrides (from config/middlewares.js registration)
      const configDirectives = (config && config.directives) ? config.directives : {};
      for (const [key, values] of Object.entries(configDirectives)) {
        directives[key] = Array.isArray(values) ? values : [values];
      }

      ctx.set('Content-Security-Policy', buildCspHeader(directives));
    } catch (err) {
      strapi.log.warn(`[csp-header] Failed to set CSP header: ${err.message}`);
      // Non-fatal: response proceeds without CSP header
    }

    // 2. Additional security headers (VAPT #21) — set unconditionally outside
    //    the CSP try/catch so they are always present even if CSP building fails.
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
      ctx.set(header, value);
    }
  };
};

// ── Exports for unit testing ──────────────────────────────────────────────────

module.exports.buildCspHeader           = buildCspHeader;
module.exports.BASE_DIRECTIVES          = BASE_DIRECTIVES;
module.exports.ADMIN_EXTRA              = ADMIN_EXTRA;
module.exports.TRUSTED_MEDIA_ORIGINS    = TRUSTED_MEDIA_ORIGINS;
module.exports.buildTrustedMediaOrigins = buildTrustedMediaOrigins;
module.exports.SECURITY_HEADERS         = SECURITY_HEADERS;
module.exports.PERMISSIONS_POLICY_VALUE = PERMISSIONS_POLICY_VALUE;
