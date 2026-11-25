import type { Core } from '@strapi/strapi';
import { buildAllowedOrigins } from '../src/utils/cors-origins';

/**
 * Middleware stack — ported from abg-cms. ORDER IS SECURITY-CRITICAL: see the
 * notes on each entry before moving anything.
 */

// Trusted image/media origins for the Content-Security-Policy. Cloud hosts are
// added ONLY when the matching bucket is configured; with the default local
// (self-hosted) media library this list stays empty.
function buildTrustedMediaOrigins(): string[] {
  const origins: string[] = [];
  const hostOf = (url?: string) => {
    if (!url) return;
    try {
      origins.push(new URL(url).host);
    } catch {
      // Invalid URL — skipped; fix the env var.
    }
  };

  const gcsBucket = process.env.GCS_BUCKET;
  if (gcsBucket) {
    origins.push('storage.googleapis.com', `${gcsBucket}.storage.googleapis.com`);
  }
  hostOf(process.env.GCS_CDN_URL);

  const awsBucket = process.env.AWS_BUCKET;
  const awsRegion = process.env.AWS_REGION || 'us-east-1';
  if (awsBucket) {
    origins.push(`${awsBucket}.s3.${awsRegion}.amazonaws.com`, `s3.${awsRegion}.amazonaws.com`);
  }
  hostOf(process.env.AWS_CDN_URL);

  return origins;
}

const trustedMediaOrigins = buildTrustedMediaOrigins();

const config: Core.Config.Middlewares = [
  // VAPT #14 — Banner grabbing: strip Server / X-Powered-By. Must be OUTERMOST
  // so its after-next() phase runs after every other middleware set headers.
  'global::header-hardener',
  // Admin HTML injector (nonces, autocomplete, CAPTCHA) — outermost so it sees the final HTML.
  'global::admin-html-injector',
  // VAPT #22 — HTTP → HTTPS redirect (production only).
  'global::https-redirect',
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          'img-src': ["'self'", 'data:', 'blob:', 'market-assets.strapi.io', ...trustedMediaOrigins],
          'media-src': ["'self'", 'data:', 'blob:', ...trustedMediaOrigins],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  // VAPT #16 — Misconfigured CORS: explicit allowlist (CORS_ORIGINS), never a
  // reflected wildcard. credentials:true is safe only because of the allowlist.
  {
    name: 'strapi::cors',
    config: {
      origin: buildAllowedOrigins(),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      headers: [
        'Content-Type',
        'Authorization',
        'Origin',
        'Accept',
        'X-Requested-With',
        'X-Step-Up-Token', // cross-origin step-up auth (VAPT #4)
      ],
      keepHeadersOnError: true,
      maxAge: 7200,
    },
  },
  // 'strapi::poweredBy' intentionally removed — VAPT #14.
  'strapi::query',
  'strapi::body',
  // VAPT #5 — canonicalize email fields (trim + lowercase) on every write.
  'global::email-canonicalizer',
  // VAPT #6 — login response nonce (blocks response manipulation / replay).
  'global::login-nonce',
  'strapi::session',
  'strapi::favicon',
  // VAPT #3 — upload security must wrap strapi::public (koa-static) so its
  // after-next() phase can set Content-Disposition + nosniff on served files.
  'global::upload-security',
  'strapi::public',
  // XSS / HTML injection — deep-sanitise body + query.
  'global::xss-input-sanitizer',
  // VAPT #17 — nonce-based CSP (no unsafe-inline in script-src).
  'global::csp-header',
  // ERP session manager — order: hardener → HSTS → rate-limit → session-auth → step-up → api-guard → logger
  'plugin::erp-session-manager.admin-session-hardener',
  'plugin::erp-session-manager.hsts',
  'plugin::erp-session-manager.rate-limit',
  'plugin::erp-session-manager.session-auth',
  'plugin::erp-session-manager.step-up-auth',
  'plugin::erp-session-manager.admin-api-guard', // VAPT #13
  'plugin::erp-session-manager.session-activity-logger',
];

export default config;
