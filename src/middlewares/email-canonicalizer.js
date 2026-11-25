'use strict';

/**
 * Email Canonicalizer Middleware (VAPT #5 — Duplicate Email)
 *
 * Normalises every `email` field found in the request body BEFORE any
 * business-logic runs, so that comparisons, uniqueness checks, and DB
 * lookups are always performed against the same canonical form:
 *
 *   1. Trim leading/trailing whitespace
 *   2. Lowercase the entire address
 *
 * This means "User@Example.COM " and "user@example.com" are treated as
 * the same address everywhere — in app-layer checks, DB UNIQUE constraints,
 * and users-permissions uniqueness enforcement.
 *
 * Only WRITE methods (POST / PUT / PATCH) with a parsed body are processed;
 * GET / DELETE / HEAD / OPTIONS pass through untouched.
 *
 * Exported helpers (`canonicalizeEmail`, `canonicalizeBody`) are pure
 * functions so they can be unit-tested independently.
 */

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Canonicalize a single email string.
 * Returns the normalised value, or the original if it is not a non-empty string.
 *
 * @param {*} value
 * @returns {*}
 */
function canonicalizeEmail(value) {
  if (typeof value === 'string' && value.length > 0) {
    return value.trim().toLowerCase();
  }
  return value;
}

/**
 * Recursively walk a parsed body object and canonicalize any key named "email".
 * Arrays are walked element-by-element so nested objects inside arrays are handled.
 * Non-object / non-array values are returned as-is.
 *
 * @param {*} body
 * @returns {*}
 */
function canonicalizeBody(body) {
  if (body === null || typeof body !== 'object') {
    return body;
  }

  if (Array.isArray(body)) {
    return body.map(canonicalizeBody);
  }

  const result = {};
  for (const key of Object.keys(body)) {
    if (key === 'email') {
      result[key] = canonicalizeEmail(body[key]);
    } else if (body[key] !== null && typeof body[key] === 'object') {
      result[key] = canonicalizeBody(body[key]);
    } else {
      result[key] = body[key];
    }
  }
  return result;
}

module.exports = (config, { strapi }) => {
  return async (ctx, next) => {
    const method = ctx.method && ctx.method.toUpperCase();

    if (
      WRITE_METHODS.has(method) &&
      ctx.request &&
      ctx.request.body &&
      typeof ctx.request.body === 'object'
    ) {
      ctx.request.body = canonicalizeBody(ctx.request.body);
    }

    return next();
  };
};

// Export pure helpers for unit testing
module.exports.canonicalizeEmail = canonicalizeEmail;
module.exports.canonicalizeBody  = canonicalizeBody;
