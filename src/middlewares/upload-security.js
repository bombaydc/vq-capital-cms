'use strict';

/**
 * upload-security — VAPT Finding #3 (Malicious File Upload) Gaps 2, 3, 4.
 *
 * Responsibilities:
 *
 *   Before next():
 *     Gap 4 — Rate-limit POST /upload requests: 20 attempts per IP per 15 min.
 *     Gap 3 — Reject uploads containing dangerous file extensions anywhere in
 *              the filename (catches double-extension attacks like photo.jpg.exe).
 *
 *   After next():
 *     Gap 2 — Set response security headers for all GET /uploads/* responses:
 *              • X-Content-Type-Options: nosniff  (reinforcement of Helmet default)
 *              • Content-Disposition: attachment  for all non-inline types
 *                (inline set = safe raster images + PDF + JSON + SVG — see
 *                 isInlineMime below for the per-type rationale)
 *
 * Positioning in config/middlewares.js:
 *   MUST be placed BEFORE 'strapi::public'. koa-static runs with defer:true,
 *   meaning it sets Content-Type on the RETURN path after all inner middleware
 *   complete. Wrapping strapi::public (being outer to it) ensures this
 *   middleware's after-next() phase executes AFTER koa-static has set
 *   Content-Type on the response.
 *
 * No new npm packages required. mime-types is already in package.json.
 *
 * References: VAPT Finding #3, Gaps 2/3/4
 */

// ── Gap 3: Dangerous extension regex ─────────────────────────────────────────

/**
 * Matches any dangerous executable/script extension anywhere in the filename,
 * not just the last component. Catches double-extension attacks such as
 * "malware.jpg.exe" or "payload.php.bat". Word boundary (\b) prevents
 * false matches inside words like "executable".
 */
// Client executables + server-side scripts (php/jsp/asp/cgi…): a script uploaded as
// text/plain would pass the MIME allowlist and could execute if a PHP/JSP-capable
// web server ever fronts public/uploads.
const DANGEROUS_EXTENSION_RE = /\.(exe|dll|bat|cmd|sh|ps1|msi|jar|vbs|pif|scr|com|cpl|hta|wsf|jse|vbe|php\d?|phtml|phar|jspx?|aspx?|ashx|asmx|cgi|pl|py|rb|htaccess)\b/i;

// ── Gap 4: In-memory sliding-window rate limiter ─────────────────────────────

/**
 * Per-IP upload attempt counters.
 * Key:   "upload:<ip>"
 * Value: { count: number, resetAt: number (ms epoch) }
 */
const _uploadCounters = new Map();

const UPLOAD_RATE_LIMIT = {
  windowMs:    900_000, // 15 minutes
  maxAttempts: 20,
};

/**
 * Check whether the given IP is within the upload rate limit.
 * Returns { allowed: boolean, resetAt: number }.
 *
 * @param {string} ip
 * @returns {{ allowed: boolean, resetAt: number }}
 */
function checkUploadRateLimit(ip) {
  const key = `upload:${ip}`;
  const now  = Date.now();
  const entry = _uploadCounters.get(key);

  if (!entry || entry.resetAt <= now) {
    return { allowed: true, resetAt: now + UPLOAD_RATE_LIMIT.windowMs };
  }
  return {
    allowed: entry.count < UPLOAD_RATE_LIMIT.maxAttempts,
    resetAt: entry.resetAt,
  };
}

/**
 * Increment the upload counter for the given IP.
 * Schedules a cleanup of the counter entry once the window expires.
 *
 * @param {string} ip
 */
function incrementUploadCounter(ip) {
  const key = `upload:${ip}`;
  const now  = Date.now();
  let entry  = _uploadCounters.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + UPLOAD_RATE_LIMIT.windowMs };
  }
  entry.count += 1;
  _uploadCounters.set(key, entry);

  // TTL cleanup — matches pattern in rate-limiter.js
  const delay = entry.resetAt - now;
  setTimeout(() => {
    const current = _uploadCounters.get(key);
    if (current && current.resetAt <= Date.now()) {
      _uploadCounters.delete(key);
    }
  }, delay).unref();
}

// ── Gap 2: Inline-renderable MIME type checks ────────────────────────────────

/**
 * Normalise a MIME string for comparison: drop any parameters
 * ("image/jpeg; charset=utf-8" → "image/jpeg"), trim, lowercase.
 *
 * @param {string|null|undefined} mime
 * @returns {string} normalised base type, or '' when there is nothing to parse
 */
function baseMime(mime) {
  if (!mime) return '';
  return mime.split(';')[0].trim().toLowerCase();
}

/**
 * Raster image formats that are always safe to render inline — they are decoded
 * by the image pipeline and can never become an active document.
 */
const INLINE_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/tiff',
]);

/**
 * Additional types explicitly opted into inline rendering, on top of
 * INLINE_IMAGE_MIMES. These are NOT inline-safe by default; each is a
 * deliberate decision:
 *
 *   application/pdf   — rendered by the browser's sandboxed PDF viewer, not as
 *                       a same-origin document. Low risk.
 *   application/json  — served as text. Safe only because
 *                       `X-Content-Type-Options: nosniff` is set below, which
 *                       stops the browser sniffing it into HTML.
 *   image/svg+xml     — ⚠️ SVG is XML and can carry <script>/onload=. Served
 *                       inline from our own origin it is a stored-XSS vector.
 *                       Enabled per explicit request, matching the same
 *                       decision already made for `allowedTypes` in
 *                       config/plugins.js (Option C — no sanitization).
 *                       To re-harden: drop this entry, or add server-side SVG
 *                       sanitization (DOMPurify+jsdom / svg-sanitizer).
 */
const INLINE_EXTRA_MIMES = new Set([
  'application/pdf',
  'application/json',
  'image/svg+xml',
]);

/**
 * Returns true when the MIME type is a safe-to-display-inline image format.
 *
 * This is the *narrow* check — raster images only, no SVG. Kept separate from
 * isInlineMime() because "can never be active content" is a genuinely different
 * property from "we have chosen to serve this inline".
 *
 * @param {string|null|undefined} mime
 * @returns {boolean}
 */
function isInlineImageMime(mime) {
  return INLINE_IMAGE_MIMES.has(baseMime(mime));
}

/**
 * Returns true when the MIME type should be served with
 * `Content-Disposition: inline` rather than forced as a download.
 *
 * This is the check the serve path and both cloud upload providers use.
 *
 * @param {string|null|undefined} mime
 * @returns {boolean}
 */
function isInlineMime(mime) {
  const base = baseMime(mime);
  return INLINE_IMAGE_MIMES.has(base) || INLINE_EXTRA_MIMES.has(base);
}

// ── Upload path helpers ───────────────────────────────────────────────────────

/**
 * Returns true when the request targets an upload submission endpoint.
 * Covers both the admin upload path (/upload/) and content-API path (/api/upload).
 *
 * @param {string} method
 * @param {string} path
 * @returns {boolean}
 */
function isUploadSubmission(method, path) {
  if (method !== 'POST') return false;
  return (
    path === '/upload'      ||
    path === '/upload/'     ||
    path.startsWith('/upload?')   ||
    path === '/api/upload'  ||
    path === '/api/upload/'
  );
}

// ── Middleware factory ────────────────────────────────────────────────────────

function handleUploadGuard(ctx, strapi, method, path) {
  const ip = ctx.ip || (ctx.request && ctx.request.ip) || 'unknown';

  const rlStatus = checkUploadRateLimit(ip);
  if (!rlStatus.allowed) {
    const retryAfterSeconds = Math.ceil((rlStatus.resetAt - Date.now()) / 1000);
    strapi.log.warn(`[upload-security] Rate limit exceeded for IP ${ip} on ${method} ${path}`);
    ctx.status = 429;
    ctx.set('Retry-After', String(retryAfterSeconds));
    ctx.body = {
      data: null,
      meta: {},
      error: {
        status: 429,
        name: 'TooManyRequestsError',
        message: `Too many upload attempts. Try again in ${retryAfterSeconds} seconds.`,
        details: { retryAfterSeconds },
      },
    };
    return false;
  }
  incrementUploadCounter(ip);

  const rawFiles = ctx.request.files && ctx.request.files.files;
  if (rawFiles) {
    const filesArray = Array.isArray(rawFiles) ? rawFiles : [rawFiles];
    for (const file of filesArray) {
      const filename = file.originalFilename || file.name || file.originalname || '';
      if (DANGEROUS_EXTENSION_RE.test(filename)) {
        strapi.log.warn(`[upload-security] Dangerous extension in "${filename}" from IP ${ip} — rejected`);
        ctx.status = 400;
        ctx.body = {
          data: null,
          meta: {},
          error: {
            status: 400,
            name: 'ValidationError',
            message: `File "${filename}" contains a disallowed extension.`,
            details: { filename },
          },
        };
        return false;
      }
    }
  }

  return true;
}

function applyUploadServeHeaders(ctx, strapi, method, path) {
  if (method === 'GET' && path.startsWith('/uploads/')) {
    ctx.set('X-Content-Type-Options', 'nosniff');
    try {
      const contentType = ctx.response.get('Content-Type') || '';
      if (!isInlineMime(contentType)) {
        const filename = path.split('/').pop() || 'download';
        ctx.set('Content-Disposition', `attachment; filename="${filename}"`);
      }
    } catch (err) {
      strapi.log.warn(`[upload-security] Failed to set headers for ${path}: ${err.message}`);
    }
  }
}

module.exports = function createUploadSecurityMiddleware(config, { strapi }) {
  return async function uploadSecurityMiddleware(ctx, next) {
    const method = (ctx.method || '').toUpperCase();
    const path   = ctx.path || '';

    if (isUploadSubmission(method, path)) {
      const allowed = handleUploadGuard(ctx, strapi, method, path);
      if (!allowed) return;
    }

    await next();

    applyUploadServeHeaders(ctx, strapi, method, path);
  };
};

// Export pure helpers for unit testing (same pattern as xss-input-sanitizer.js)
module.exports.DANGEROUS_EXTENSION_RE  = DANGEROUS_EXTENSION_RE;
module.exports.isInlineImageMime       = isInlineImageMime;
module.exports.isInlineMime            = isInlineMime;
module.exports.baseMime                = baseMime;
module.exports.INLINE_IMAGE_MIMES      = INLINE_IMAGE_MIMES;
module.exports.INLINE_EXTRA_MIMES      = INLINE_EXTRA_MIMES;
module.exports.checkUploadRateLimit    = checkUploadRateLimit;
module.exports.incrementUploadCounter  = incrementUploadCounter;
module.exports._uploadCounters         = _uploadCounters;
module.exports.UPLOAD_RATE_LIMIT       = UPLOAD_RATE_LIMIT;
module.exports.isUploadSubmission      = isUploadSubmission;
