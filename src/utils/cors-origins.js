'use strict';

/**
 * CORS origin utilities — VAPT #16 (Misconfigured CORS)
 *
 * Problem: Strapi's default CORS config uses `origin: '*'` + `credentials: true`.
 * @koa/cors has built-in logic: when origin is '*' AND credentials is true it
 * reflects the request's Origin verbatim as Access-Control-Allow-Origin.
 * Combined with Access-Control-Allow-Credentials: true, this lets any attacker-
 * controlled site read authenticated API responses with the victim's cookies.
 *
 * Solution: replace the wildcard with an explicit allowlist built from env vars,
 * and use a checker function so @koa/cors never falls into the reflection path.
 *
 * References: VAPT #16; OWASP CORS Cheat Sheet; CWE-346 (Origin Validation Error)
 */

// ---------------------------------------------------------------------------
// buildAllowedOrigins
// ---------------------------------------------------------------------------

/**
 * Builds the CORS origin allowlist from environment variables.
 *
 * Sources (merged, deduplicated):
 *   CORS_ORIGINS  — comma-separated list of origins (highest priority)
 *                   e.g. "https://app.example.com,https://admin.example.com"
 *   APP_URL       — single production application URL
 *   PUBLIC_URL    — alternative/CDN-facing URL
 *
 * Development auto-additions (NODE_ENV !== 'production' only):
 *   http://localhost:1337   — default Strapi dev server
 *   http://localhost:3000   — common React / Next.js dev port
 *   http://localhost:5173   — Vite dev server default
 *   http://localhost:4200   — Angular CLI dev server default
 *   http://127.0.0.1:1337  — loopback alias for Strapi
 *
 * Secure defaults:
 *   - Returns an empty array when no env vars are set in production.
 *     An empty allowlist causes makeCorsOriginChecker() to deny ALL cross-origin
 *     requests. Operators MUST set CORS_ORIGINS (or APP_URL / PUBLIC_URL) to
 *     allow legitimate cross-origin access in production.
 *   - Trailing slashes are stripped (browsers never send them in the Origin header).
 *   - Empty strings and duplicates are discarded.
 *
 * @returns {string[]} Deduplicated array of allowed origin strings.
 */
function buildAllowedOrigins() {
  const seen = new Set();

  function add(raw) {
    if (!raw || typeof raw !== 'string') return;
    const origin = raw.trim().replace(/\/$/, ''); // strip trailing slash
    if (origin) seen.add(origin);
  }

  // 1. Explicit comma-separated list
  if (process.env.CORS_ORIGINS) {
    process.env.CORS_ORIGINS.split(',').forEach(add);
  }

  // 2. Single URL env vars
  add(process.env.APP_URL);
  add(process.env.PUBLIC_URL);

  // 3. Development origins — never added in production
  if (process.env.NODE_ENV !== 'production') {
    add('http://localhost:1337');
    add('http://localhost:3000');
    add('http://localhost:5173');
    add('http://localhost:4200');
    add('http://127.0.0.1:1337');
  }

  return Array.from(seen);
}

// ---------------------------------------------------------------------------
// makeCorsOriginChecker
// ---------------------------------------------------------------------------

/**
 * Returns an @koa/cors-compatible `origin` function that:
 *   - returns the request's Origin if it appears in `allowedOrigins`
 *   - returns false (string) for every other origin, including when no
 *     Origin header is present
 *
 * Returning false causes @koa/cors to omit the Access-Control-Allow-Origin
 * header entirely, so the browser blocks the cross-origin request.
 *
 * Matching is exact and case-sensitive (RFC 6454 §6.1 — origins are
 * case-sensitive; browsers always send them in lower-case).
 *
 * @param {string[]} allowedOrigins — list produced by buildAllowedOrigins()
 * @returns {(ctx: object) => string | false}
 */
function makeCorsOriginChecker(allowedOrigins) {
  const allowedSet = new Set(allowedOrigins);

  return function corsOriginChecker(ctx) {
    const requestOrigin = ctx.get ? ctx.get('Origin') : '';
    if (!requestOrigin) return false;
    return allowedSet.has(requestOrigin) ? requestOrigin : false;
  };
}

module.exports = { buildAllowedOrigins, makeCorsOriginChecker };
