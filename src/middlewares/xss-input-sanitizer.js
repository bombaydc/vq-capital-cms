'use strict';

const sanitizeHtml = require('sanitize-html');

const SANITIZE_OPTIONS = {
  allowedTags: [
    'a', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col',
    'colgroup', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em',
    'figure', 'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre',
    'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'summary',
    'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time',
    'tr', 'u', 'ul', 'var',
  ],
  allowedAttributes: {
    'a':   ['href', 'name', 'target', 'rel'],
    'img': ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading'],
    '*':   ['class', 'id', 'style', 'lang', 'dir', 'title'],
  },
  allowedSchemes: ['http', 'https', 'ftp', 'mailto', 'tel'],
  allowedSchemesByTag: {
    img: ['http', 'https', 'data'],
  },
};

/**
 * Field names that must never be HTML-sanitized.
 *
 * sanitize-html encodes '&' → '&amp;', '<' → '&lt;', etc., which corrupts
 * password strings before they reach bcrypt comparison. Passwords must be
 * passed through byte-for-byte regardless of which path they arrive on.
 */
const PASSWORD_FIELD_KEYS = new Set([
  'password',
  'currentPassword',
  'oldPassword',
  'newPassword',
  'passwordConfirmation',
  'confirmPassword',
]);

/**
 * Recursively sanitize all string values in a plain object or array.
 * Non-string, non-object, non-array values are returned unchanged.
 *
 * Pass `_key` to skip sanitization for known password field names.
 *
 * @param {unknown} value
 * @param {string|number|undefined} _key  — object key or array index of this value
 * @returns {unknown}
 */
function sanitizeDeep(value, _key) {
  if (typeof value === 'string') {
    // Never sanitize password fields — special characters (& < > /) must reach
    // bcrypt intact. Path-level exemption in SANITIZE_EXEMPT_PATHS covers login;
    // this key-level exemption covers profile-update endpoints (PUT /admin/users/me).
    if (PASSWORD_FIELD_KEYS.has(_key)) return value;
    return sanitizeHtml(value, SANITIZE_OPTIONS);
  }
  if (Array.isArray(value)) {
    return value.map((item, idx) => sanitizeDeep(item, idx));
  }
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value)) {
      result[key] = sanitizeDeep(value[key], key);
    }
    return result;
  }
  return value;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

// Paths exempt from request-body sanitization.
// Auth endpoints pass raw passwords — sanitizing them corrupts special characters
// (e.g. '&' → '&amp;') before bcrypt comparison, causing permanent login failure.
// Form submission endpoints validate first, then sanitize manually after validation.
const SANITIZE_EXEMPT_PATHS = new Set([
  '/admin/login',
  '/admin/logout',
  '/admin/register-admin',
  '/admin/forgot-password',
  '/admin/reset-password',
  '/admin/renew-token',
  '/admin/change-password',
  '/api/contact-form-submission',
  '/api/became-dealer-form-submission',
  '/api/news-letter-form-submission',
  '/api/electrician-form-submission',
]);

// Each value below is the six-character JSON escape *sequence* (backslash, 'u',
// four hex digits) — not the character itself. These are written into the
// serialized JSON text, where such a sequence is a valid string escape that
// JSON.parse decodes back to the original character.
const ESCAPE_MAP = {
  '<':  '\\u003c',
  '>':  '\\u003e',
  '&':  '\\u0026',
  '/':  '\\u002f',
};

const ESCAPE_REGEX = /[<>&/]/g;

/**
 * Unicode-escape HTML-sensitive characters in an already-serialized JSON string.
 *
 * This MUST operate on the JSON *text*, never as a JSON.stringify replacer.
 * A replacer rewrites the parsed values themselves, so `JSON.stringify` then
 * escapes the backslash and `JSON.parse` hands back the six literal characters
 * of the escape sequence instead of the original character — permanently
 * corrupting every `/`, `<`, `>` and `&` in every response (see p6).
 *
 * Escaping the serialized text instead keeps the wire format safe to embed in
 * an HTML <script> block while leaving the parsed value byte-identical to the
 * original. In JSON text these four characters only ever occur inside string
 * literals — none is a structural character — so a blanket replace is safe.
 *
 * Note this is a JSON-embedding safeguard, not an XSS control on its own:
 * clients must still encode values at render time. Input-side tag stripping
 * (`sanitizeDeep`) remains the primary stored-XSS defence.
 *
 * @param {string} json — output of JSON.stringify
 * @returns {string}
 */
function escapeJsonText(json) {
  return json.replaceAll(ESCAPE_REGEX, (ch) => ESCAPE_MAP[ch]);
}

const RESPONSE_SANITIZE_EXEMPT = new Set([
  '/api/erp-session-manager/captcha/challenge',
]);

function sanitizeRequestBody(ctx, strapi, method, path) {
  const body = ctx.request.body;
  if (body !== null && body !== undefined && typeof body === 'object' && !Buffer.isBuffer(body)) {
    try {
      ctx.request.body = sanitizeDeep(body);
    } catch (err) {
      strapi.log.warn(`[xss-input-sanitizer] Sanitization error on ${method} ${path}: ${err.message}`);
    }
  }
}

function sanitizeRequestQuery(ctx, strapi, method, path) {
  if (ctx.request.query && typeof ctx.request.query === 'object') {
    try {
      ctx.request.query = sanitizeDeep(ctx.request.query);
    } catch (err) {
      strapi.log.warn(`[xss-input-sanitizer] Query sanitization error on ${method} ${path}: ${err.message}`);
    }
  }
}

function sanitizeResponseBody(ctx, strapi, path) {
  if (
    (path.startsWith('/api') || path.startsWith('/erp-session-manager')) &&
    !RESPONSE_SANITIZE_EXEMPT.has(path)
  ) {
    const ct = ctx.response.get('Content-Type') || '';
    const body = ctx.body;

    // Buffers and streams are already-encoded payloads (file downloads, CSV/XLSX
    // exports). JSON.stringify would turn a Buffer into {"type":"Buffer",...}.
    const isSerializable = body && typeof body === 'object' &&
      !Buffer.isBuffer(body) && typeof body.pipe !== 'function';

    if (ct.includes('application/json') && isSerializable) {
      try {
        const json = JSON.stringify(body);
        if (json === undefined) return;
        // Hand Koa the pre-serialized, escaped text. Content-Type is re-asserted
        // because assigning a string body would otherwise let Koa infer text/plain.
        ctx.body = escapeJsonText(json);
        ctx.type = 'application/json';
      } catch (err) {
        strapi.log.warn(`[xss-input-sanitizer] JSON re-serialization error on ${path}: ${err.message}`);
      }
    }
  }
}

module.exports = function createXssInputSanitizerMiddleware(config, { strapi }) {
  return async function xssInputSanitizer(ctx, next) {
    const method = ctx.method ? ctx.method.toUpperCase() : '';
    const path   = ctx.path || '';

    const isWritePath = WRITE_METHODS.has(method) &&
      !SANITIZE_EXEMPT_PATHS.has(path) &&
      (path.startsWith('/admin') || path.startsWith('/api'));

    if (isWritePath) {
      sanitizeRequestBody(ctx, strapi, method, path);
      sanitizeRequestQuery(ctx, strapi, method, path);
    }

    await next();

    sanitizeResponseBody(ctx, strapi, path);
  };
};

// Export helpers for testing
module.exports.sanitizeDeep = sanitizeDeep;
module.exports.SANITIZE_OPTIONS = SANITIZE_OPTIONS;
module.exports.escapeJsonText = escapeJsonText;
